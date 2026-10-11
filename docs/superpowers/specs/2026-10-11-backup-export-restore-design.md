# Backup, export and restore (F15 / M4) — design

Date: 2026-10-11. Status: approved in brainstorming; implementation plan next.

## Goal
Make "you can leave any time, with everything" true and safe. An admin can take verified
backups on a schedule or on demand, restore one (in-app, on a fresh install, or from the CLI),
and export a human-readable archive that works offline without HomeCenter. Protection is the
user's choice: none, a recovery key, or a password zip.

## Decisions
- **One archive format, two kinds.** A `backup` (restorable: DB snapshot + files + readable
  layer) and an `export` (readable layer + files, scoped, never restorable). One builder.
- **Protection: three options, default None.** None / Recovery key (age X25519) / Password zip
  (AES-256, double-wrapped). Password rule: **at least 6 characters, nothing else.**
- **Restore: full replace only** (no merge). Three entry points, one pipeline. Applied at boot,
  never under live connections. Automatic rollback; one-step undo.
- **Destination: a folder path** (default `/data/backups`, or any mounted path). No cloud
  targets in v1.
- Search index and embedding models are derived; never backed up (rebuilt after restore).

Out of scope (v1): merge/partial restore, S3/WebDAV targets, CSV import (F12), hosted relay,
history packet PDF (F16; builds on the export later).

## Persistent state captured
- DB: `DATABASE_URL` (`/data/homecenter.db` in Docker).
- Uploads: `UPLOAD_DIR` (`/data/uploads`). Attachments at `<recordType>/<recordId>/<filename>`
  (dir from `attachmentDir()`); asset photos at `{properties|vehicles|equipment|people}/<id>/<imageFilename>`.
- Not captured: `SEARCH_INDEX_PATH`, `MODELS_DIR`, temp files.

## Archive layout
File name `homecenter-YYYY-MM-DD-HHmm.hcbackup` (a zip). Export: `homecenter-export-…`.

```
manifest.json      formatVersion (1), kind, scope, appVersion, migration (latest applied
                   Prisma migration name), createdAt, protection, counts per model,
                   files: [{ path, size, sha256 }], warnings
db/homecenter.db   VACUUM INTO snapshot                 (backup only)
secrets.json       { mailPassword?, llmApiKey? } plain  (protected backups only)
files/…            same relative layout as UPLOAD_DIR, only files referenced by the snapshot
readable/
  index.html       offline viewer (inline CSS/JS, no network)
  data.js          window.HC_DATA = {...}  (file:// blocks fetch)
  data/*.json      public shape, one file per entity
  csv/*.csv        UTF-8 with BOM
```

Readable layer never contains password hashes, session data, encrypted secrets or
notifications. Users appear as name + email. Public JSON shape (`formatVersion: 1`, ISO dates,
enum strings, stable field names) is documented in `docs/export-format.md` and is a contract.

Every archive gets a plaintext sidecar `<name>.meta.json`: createdAt, kind, size, sha256 of the
final file, appVersion, migration, protection, key fingerprint (if key). No record content.
The app lists and checks backups from sidecars without decrypting.

## Protection
| Option | File | Scheduled backups | Opens outside app |
|---|---|---|---|
| None (default) | `.hcbackup` | plain | any zip tool |
| Recovery key | `.hcbackup.age` | server holds **public key only**; cannot decrypt its own backups | `age -d -i key.txt` |
| Password zip | `.hcbackup.zip` | passphrase stored with secret-box (under `AUTH_SECRET`) | 7-Zip / WinRAR / Keka |

- **Recovery key:** keypair generated in the browser (`age-encryption`); only the public key
  and fingerprint are sent. Setup requires downloading the recovery kit
  (`homecenter-recovery-key.txt`: key, fingerprint, in-app and `age` CLI restore steps) and
  ticking "I saved it". Losing it makes those backups unrecoverable; the UI says so.
- **Password zip:** outer AES-256 zip (`@zip.js/zip.js`) containing a single inner
  `homecenter-….hcbackup`, so file names are hidden. Entered twice. Minimum 6 characters,
  no other rules, no strength meter. UI states that anyone with `/data` + `AUTH_SECRET` can
  open scheduled password backups.
- **Verify before encrypt:** build the plaintext archive to a temp file under `/data`
  (same disk as the live data), verify it fully, stream-encrypt to the destination, record the
  final sha256, delete the temp file.
- **Secrets across machines:** protected backups carry `secrets.json` (decrypted mail password
  and LLM key) inside the protection; restore re-wraps them under the current `AUTH_SECRET`.
  Unprotected backups never contain them decrypted; DB ciphertext still works under the same
  `AUTH_SECRET`, otherwise restore reports "re-enter mail password / LLM key" (the settings
  pages already handle unreadable secrets).
- **Key rotation:** a new key applies to future backups; each backup shows its fingerprint.
  Turning protection off needs confirmation.
- **Exports:** None or Password zip, chosen per export. "Exclude Health" defaults on for scope
  Everything.
- Keys and passphrases supplied for restore are used in memory only, never stored.
- Not protected against: someone holding `/data` and `AUTH_SECRET` (they have the live data).
- Plan task: confirm `age-encryption` (0.3.1) and zip.js stream multi-GB inputs; if not,
  encrypt in chunks without loading the archive into memory.

## Units (`lib/backup/`)
| Unit | Responsibility |
|---|---|
| `snapshot.ts` | `VACUUM INTO` temp file; list referenced files **from the snapshot**; missing files become warnings |
| `readable.ts` | snapshot → public JSON, CSV, `data.js`, `index.html`; takes a scope (all / one asset / all minus Health) |
| `archive.ts` | streaming zip writer (fflate), checksums, manifest, writes `*.partial` then renames |
| `protect.ts` | none / age / password-zip wrappers, read and write |
| `verify.ts` | checksums, `PRAGMA integrity_check`, manifest + version compatibility; used by verify-after-write, dry run, CLI |
| `restore.ts` | dry run, stage, pending marker; `apply` used by the boot script |
| `store.ts` | list from sidecars, retention pruning (only valid sidecar+archive pairs), free space, same-device check |
| `scheduler.ts` | 15-minute tick from `instrumentation.ts`; due/catch-up logic; one job at a time |
| `jobs.ts` | `BackupRun` lifecycle, progress, alerts |

Server actions in `lib/actions/backup.ts`; streaming routes under `app/api/backup/`
(download, upload for restore, export). All use a new `requireAdmin()` helper
(`lib/auth-guard.ts`); existing inline admin checks may migrate to it opportunistically.

## Data model
- `BackupSettings` (singleton): `schedule` (OFF|DAILY|WEEKLY), `time` (HH:mm), `weekday?`,
  `folder` (default `/data/backups`), `keep` (default 14), `protection` (NONE|KEY|PASSWORD),
  `publicKey?`, `keyFingerprint?`, `passphraseEnc?`, `hintDismissedAt?`.
- `BackupRun`: `id`, `kind` (BACKUP|EXPORT|RESTORE), `trigger` (MANUAL|SCHEDULE|CLI),
  `status` (RUNNING|OK|WARN|FAILED|INTERRUPTED), `startedAt`, `finishedAt?`, `file?`, `size?`,
  `sha256?`, `protection`, `progressDone`, `progressTotal`, `warnings` (JSON), `error?`,
  `createdById?`.
- The folder (sidecars) is the source of truth for which backups exist; `BackupRun` is for job
  state, history and staleness.

## Backup flow
1. Acquire the single-job lock (scheduler skips if held; manual shows "already running").
2. `VACUUM INTO` temp snapshot; read referenced files from it.
3. Write archive (`*.partial`): manifest, snapshot, files, readable layer, `secrets.json` if
   protected. Progress = files done / total.
4. Verify. Protect if configured. Rename into place, write sidecar.
5. Prune to `keep`. Record run (OK, or WARN with missing files). Alert on FAILED.

## Restore flow
Entry points:
1. **Settings → Data → Restore** (admin): upload (streamed to `/data/restore/incoming`) or pick
   from the backup list.
2. **Fresh install:** when the DB has no assets or records, the dashboard empty state offers
   "Restore from a backup" beside "Add your first asset" (admin; the seed always creates one).
3. **CLI:** `npm run restore -- <file> [--dry-run] [--key kit.txt | --passphrase-env VAR]`.

Pipeline:
1. **Dry run:** free space (~2× archive), unprotect if needed, checksums, `integrity_check`,
   refuse `kind: export`, refuse a backup whose migration is newer than the app's latest
   ("update HomeCenter first"), accept older ones. Show current vs backup counts per model,
   file count, backup date, warnings, secrets status.
2. **Confirm:** type `RESTORE`. Warn that everyone is signed out and logins become the
   backup's.
3. **Stage:** snapshot + files to `/data/restore/staging`, write `/data/restore/pending.json`.
4. **Restart:** "Restart to finish" exits the process when `HOMECENTER_SUPERVISED=1` (set in the
   Dockerfile; compose has `restart: unless-stopped`); otherwise the UI asks the user to
   restart. The CLI applies directly (app must be stopped; it checks).
5. **Apply** (`scripts/restore-apply.ts`, run by `docker-entrypoint.sh` **before**
   `prisma migrate deploy`, and by `npm start` outside Docker): rename current DB and
   `uploads/` into `/data/restore/pre-<ts>/`, move staged DB and files into place, delete the
   search index, write `/data/restore/result.json`. Any error rolls back from `pre-<ts>`.
6. **Boot:** migrations upgrade older schemas; app re-wraps `secrets.json` under the current
   `AUTH_SECRET`, bumps every user's `sessionVersion`, shows the admin "Restored from backup of
   <date>" (or the failure reason).
7. **Undo:** the latest `pre-<ts>` is kept; "Undo last restore" runs the same pipeline from
   it. Deleted after 7 days or at the next restore.

## UI: Settings → Data (admin only)
New `SETTINGS_SECTIONS` entry `data`. Top to bottom:
1. **Status strip:** last backup (time, size, verified, protection), next run, folder;
   green / amber (stale or warnings) / red (failed).
2. **Back up now:** server job with live progress; page can be left.
3. **Schedule:** Off / Daily / Weekly + time; folder (validated on save: exists, writable,
   free space; warns "same disk as your data — not a real backup" when on the same device as
   `/data`); keep last N; protection (None / Recovery key → kit setup / Password zip → enter
   twice).
4. **Backups list:** date, size, protection + fingerprint, verified; Download, Verify, Restore,
   Delete.
5. **Export:** scope (Everything / one asset), Exclude Health, protection (None / Password zip)
   → build and download; temp file deleted after.
6. **Restore:** upload; "Undo last restore" when available.

Always-visible notice when protection is None: "Backups are readable by anyone who gets the
file. They include health records and documents." (Health wording only when Health is on.)

Per-asset "Download files" becomes a scoped export on the same builder.

## Scheduling and alerts
- Tick every 15 minutes; run when today's slot (server `TZ`) has passed and no successful run
  covers it, so a restarted container catches up.
- Bell notification to admins (and email via the existing digest when mail is configured) on
  FAILED/INTERRUPTED, or when scheduled and no success within 2× the interval.
- No backups ever: dismissible hint on the Data tab.

## Error handling
| Case | Result |
|---|---|
| Referenced upload missing | Backup WARN, files listed |
| Folder unavailable / disk full | FAILED, partial deleted, alert; never falls back to `/data` silently |
| Crash or restart mid-job | Boot: remove `*.partial`, mark run INTERRUPTED, alert |
| Wrong key / passphrase | Clear error, nothing staged |
| Apply fails at boot | Roll back from `pre-<ts>`, reason in result file and UI |
| Writes during backup | Snapshot is consistent; later files simply aren't in this backup |

## CLI and docs
- `npm run backup`, `npm run backup:verify -- <file>`, `npm run restore -- <file> [...]`;
  same engine and settings.
- README "Backup & restore" replaces "stop the container and copy /data".
- `docker-compose.yml`: commented `- /volume1/backups/homecenter:/backups` mount.
- `docs/export-format.md`: archive layout and public JSON shape.
- Recovery kit and README explain opening backups without the app (7-Zip, `age`).

## Testing
Synthetic data only; never the user's data or `prisma/dev.db`.
- **Unit (vitest):** manifest/checksums; readable mappers; Health-excluded scope has no health
  rows or files; retention never deletes non-backup files; schedule due/catch-up; version
  compatibility; password-zip round trip incl. hidden inner names; age round trip; secrets
  re-wrapped under a different `AUTH_SECRET`; 6-character minimum.
- **Integration:** seed temp `/data` → backup → verify → restore-apply into a second temp
  `/data` → compare row counts and file hashes; once per protection mode; plus an older-schema
  backup through migrations; rollback on injected apply failure.
- **Browser (Playwright, scratch DB, port 3133):** Data tab (back up now, schedule, key-kit
  setup, password setup), export download, restore (dry run → confirm → apply → banner),
  undo, first-run restore, phone width, dark theme.

## Delivery slices
Each slice shippable, tested and committed:
1. Engine, Back up now, schedule, retention, alerts, Data tab (status, list, schedule), CLI
   backup/verify.
2. Protection: none / recovery key / password zip, secrets carry-over.
3. Restore: dry run, staged apply at boot, rollback, undo, fresh-install entry, CLI restore.
4. Export: readable layer, offline viewer, scopes, per-asset download on the builder,
   `docs/export-format.md`.

Until slice 4 lands, backups omit `readable/` (the manifest lists contents, so restore and
verify do not depend on it). From slice 4 on, every backup includes it.
