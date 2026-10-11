# Backup, Export and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verified scheduled/on-demand backups, three-way protection, staged restore (in-app, fresh install, CLI), and a readable offline export, all from Settings → Data.

**Architecture:** A Prisma-free engine in `lib/backup/` (snapshot, archive, verify, protect, store, restore, readable, viewer) that works on file paths and a raw libsql connection, so the same code runs in the Next server, in a boot-time apply script and in CLI scripts. Thin `*-server.ts` modules wire the engine to Prisma (settings, run history, alerts) and to the in-process scheduler. UI is a new admin-only `data` section of the existing `?tab=` Settings page.

**Tech Stack:** Next.js 16 (route handlers, server actions), Prisma 7 + `@libsql/client`, `@zip.js/zip.js` (all zips, ZIP64, AES-256), `age-encryption` 0.3.1 (recovery key), vitest, Playwright (scratch DB only).

**Spec:** `docs/superpowers/specs/2026-10-11-backup-export-restore-design.md`

## Global Constraints

- Protection options exactly: **None (default) / Recovery key / Password zip**. Password rule: **at least 6 characters, nothing else** (no strength meter, no complexity rules).
- Backup file names: `homecenter-YYYY-MM-DD-HHmm.hcbackup` (none), `.hcbackup.age` (key), `.hcbackup.zip` (password). Sidecar: `<file>.meta.json`. Exports: `homecenter-export-YYYY-MM-DD-HHmm.zip` (none or password).
- Default folder `<dataDir>/backups` (`/data/backups` in Docker); default keep **14**; schedule default **Off**.
- Restore is **full replace only**; confirmation word is `RESTORE`; undo snapshot kept **7 days** or until the next restore.
- Stale = scheduled and no backup in **2× the interval**. Scheduler tick every **15 minutes**.
- Engine files (`lib/backup/*.ts` not ending `-server.ts`, plus `scripts/*.ts`) import only relative paths and npm packages; `@/` only as `import type`.
- Never touch the user's data: no writes to `\\ugreen\docker\homecenter`, no use of `prisma/dev.db` in tests or browser checks. Tests create temp dirs under `os.tmpdir()`.
- Never kill the user's `next dev` on :3000. Browser checks run a scratch server on :3133 with scratch `DATABASE_URL`, `UPLOAD_DIR`, `SEARCH_INDEX_PATH`, `MAIL_DRY_RUN=1`.
- Each task ends with `npm test`, `npx tsc --noEmit`, `npm run lint` (baseline: 16 pre-existing problems, none new) and a commit. Commit via the Bash tool (`git commit -F <file>` with a BOM-free message file, or `-m` in bash); end messages with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UBcabZ2saeRpR6mG6TYe9r
  ```
- UI copy in plain words; match existing Settings cards (`Card className="py-5"`, `CardHeader className="px-5"`, sonner toasts).
- Read `node_modules/next/dist/docs/` for route-handler and server-action specifics before writing those (AGENTS.md).

## Review Focus

1. **Backup folder on an unmounted NAS share** (path exists in config but the mount is gone, so the folder is missing or not writable): the run must FAIL with a clear message and an alert, never create the folder silently on the container's own disk. → Task 4 test `refuses a folder that does not exist instead of creating it`; Task 5 `startBackupJob` passes `createFolder: false` for scheduled runs.
2. **Two backups in the same minute** (Back up now clicked right after a scheduled run): second file must not overwrite the first. → Task 4 test `numbers a second backup made in the same minute`.
3. **Upload file names with odd characters or a hostile `originalName`** (`../../etc/passwd`, `CON`, emoji) in exports and in the restore extraction: nothing may land outside the target root. → Task 1 test `safeJoin rejects escapes`; Task 3 test `skips a stored filename that would escape`; Task 14 test `export paths are flattened and never escape`.
4. **Restore archive that is a renamed export or a random zip**: dry run must refuse with a plain reason, not crash. → Task 3 tests `refuses an export` and `refuses a zip without a manifest`; Task 8 test `detects … junk`.
5. **Server restarted mid-backup** (container update at 03:00): partial file removed, run marked INTERRUPTED, alert raised, next slot still runs. → Task 4 test `cleanupPartials removes leftovers`; Task 5 schedule test `catches up after downtime`; Task 6 Step 9 browser check 4 (`markInterruptedRuns` needs Prisma, so it is checked against the scratch server).

---

## File map

| File | Responsibility |
|---|---|
| `lib/backup/format.ts` | Types (`Manifest`, `Sidecar`, `Protection`, `ExportScope`), constants, file naming |
| `lib/backup/paths.ts` | dataDir/db/upload/restore/work paths, `safeJoin`, `appMigrations` |
| `lib/backup/archive.ts` | Streaming zip writer/reader with sha256 per entry (zip.js) |
| `lib/backup/snapshot.ts` | `VACUUM INTO`, referenced files, latest migration, counts, integrity check |
| `lib/backup/verify.ts` | Archive verification + schema compatibility |
| `lib/backup/store.ts` | Sidecars, list, prune, delete, unique names, partial cleanup, folder status |
| `lib/backup/backup.ts` | `createBackup` engine |
| `lib/backup/schedule.ts` | Pure due/next/stale rules |
| `lib/backup/overview.ts` | Pure status-tone rule for the Data tab |
| `lib/backup/protect.ts` | age key / password zip wrap + unwrap, detection, CLI unlock args |
| `lib/backup/protect-shared.ts` | Browser-safe: fingerprint, kit parsing, 6-character rule |
| `lib/backup/raw-settings.ts` | Read backup settings + secrets from a DB file via libsql (CLI) |
| `lib/backup/restore.ts` | Dry run, stage, undo, apply-at-boot with rollback, result file |
| `lib/backup/readable.ts` | Snapshot → public JSON/CSV, scopes, export file paths |
| `lib/backup/viewer.ts` | Offline `index.html` + `data.js` |
| `lib/backup/export.ts` | `createExport` engine |
| `lib/backup/test-support.ts` | Temp dirs, migrated temp DB, sample seed (tests only) |
| `lib/backup/settings-server.ts` | Prisma: BackupSettings load/save, protection config, secrets |
| `lib/backup/jobs-server.ts` | Single-job lock, BackupRun lifecycle, progress, interrupted runs |
| `lib/backup/alerts-server.ts` | Admin notifications (CUSTOM, relatedEntityType `Backup`) |
| `lib/backup/scheduler-server.ts` | 15-minute tick |
| `lib/backup/overview-server.ts` | Everything the Data tab shows, in one call |
| `lib/backup/restore-server.ts` | Restore actions' server side + boot finalize |
| `lib/auth-guard.ts` | `requireAdmin()`, `adminSession()` |
| `lib/actions/backup.ts` | Server actions for the Data tab |
| `app/api/backup/download/route.ts` | Stream a backup file |
| `app/api/backup/upload/route.ts` | Stream a restore upload to disk |
| `app/api/backup/export/[runId]/route.ts` | Stream a finished export, then delete it |
| `components/settings/data/*.tsx` | Data tab UI |
| `scripts/restore-apply.ts`, `scripts/backup.ts`, `scripts/backup-verify.ts`, `scripts/restore.ts` | Boot apply + CLI |

---

# Slice 1 — Engine, Back up now, schedule, Data tab, CLI

### Task 1: Dependencies, format and paths

**Files:**
- Modify: `package.json` (deps)
- Create: `lib/backup/format.ts`, `lib/backup/paths.ts`
- Test: `lib/backup/format.test.ts`, `lib/backup/paths.test.ts`

**Interfaces:**
- Produces: `FORMAT_VERSION`, `SIDECAR_VERSION`, `ArchiveKind`, `Protection`, `ExportScope`, `ManifestFile`, `Manifest`, `Sidecar`, `DB_ENTRY`, `SECRETS_ENTRY`, `MANIFEST_ENTRY`, `FILES_PREFIX`, `READABLE_PREFIX`, `SIDECAR_SUFFIX`, `MIN_PASSWORD`, `stamp(d)`, `archiveName(kind, d, protection)`, `innerName(file)`, `protectionOfName(file)`; `dbPathFromUrl(url)`, `dataDir(env)`, `uploadDir(env)`, `restoreDir(env)`, `workDir(env)`, `defaultBackupFolder(env)`, `searchIndexFile(env)`, `safeJoin(root, rel)`, `appMigrations(dir?)`, `fileUrl(p)`.

- [ ] **Step 1: Install dependencies**

Run (Bash): `npm i @zip.js/zip.js@^2.23.0 age-encryption@0.3.1`
Expected: both in `dependencies`; `npm ls --depth=0` lists them.

- [ ] **Step 2: Write the failing tests**

`lib/backup/format.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { archiveName, innerName, protectionOfName, stamp } from "./format"

describe("archive names", () => {
  const d = new Date(2026, 9, 11, 3, 5) // local time
  it("stamps local date and time", () => expect(stamp(d)).toBe("2026-10-11-0305"))
  it("names backups by protection", () => {
    expect(archiveName("backup", d, "none")).toBe("homecenter-2026-10-11-0305.hcbackup")
    expect(archiveName("backup", d, "key")).toBe("homecenter-2026-10-11-0305.hcbackup.age")
    expect(archiveName("backup", d, "password")).toBe("homecenter-2026-10-11-0305.hcbackup.zip")
  })
  it("names exports as zips", () => {
    expect(archiveName("export", d, "none")).toBe("homecenter-export-2026-10-11-0305.zip")
    expect(archiveName("export", d, "password")).toBe("homecenter-export-2026-10-11-0305.zip")
  })
  it("derives the inner name of a protected file", () => {
    expect(innerName("homecenter-2026-10-11-0305.hcbackup.age")).toBe("homecenter-2026-10-11-0305.hcbackup")
    expect(innerName("homecenter-2026-10-11-0305.hcbackup.zip")).toBe("homecenter-2026-10-11-0305.hcbackup")
    expect(innerName("homecenter-export-2026-10-11-0305.zip")).toBe("homecenter-export-2026-10-11-0305-inner.zip")
  })
  it("reads protection from a backup name", () => {
    expect(protectionOfName("a.hcbackup")).toBe("none")
    expect(protectionOfName("a.hcbackup.age")).toBe("key")
    expect(protectionOfName("a.hcbackup.zip")).toBe("password")
    expect(protectionOfName("a.txt")).toBeNull()
  })
})
```

`lib/backup/paths.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { dataDir, dbPathFromUrl, defaultBackupFolder, safeJoin, searchIndexFile } from "./paths"

describe("paths", () => {
  const env = { DATABASE_URL: "file:/data/homecenter.db" }
  it("reads the db path from DATABASE_URL", () => expect(dbPathFromUrl(env.DATABASE_URL)).toBe(path.resolve("/data/homecenter.db")))
  it("puts backups next to the db", () => expect(defaultBackupFolder(env)).toBe(path.join(dataDir(env), "backups")))
  it("finds the search index like index-db does", () => {
    expect(searchIndexFile(env)).toBe(path.join(path.resolve("/data"), "search-index.db"))
    expect(searchIndexFile({ ...env, SEARCH_INDEX_PATH: "/x/s.db" })).toBe(path.resolve("/x/s.db"))
  })
  it("throws without DATABASE_URL", () => expect(() => dbPathFromUrl("")).toThrow("DATABASE_URL"))
})

describe("safeJoin rejects escapes", () => {
  const root = path.resolve("/data/uploads")
  it("joins a normal relative path", () => expect(safeJoin(root, "service/s1/a.pdf")).toBe(path.join(root, "service", "s1", "a.pdf")))
  it.each(["../x", "a/../../x", "/etc/passwd", "C:\\x", "a\\..\\..\\x", "", "a//b/../../.."])("rejects %s", (rel) =>
    expect(safeJoin(root, rel)).toBeNull())
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/backup/format.test.ts lib/backup/paths.test.ts`
Expected: FAIL, "Failed to resolve import ./format" / "./paths".

- [ ] **Step 4: Implement `lib/backup/format.ts`**

```ts
// Engine file: relative imports and npm packages only (see import-rules.test.ts),
// because scripts/restore-apply.ts and the CLI run it with tsx in the Docker runner.

export const FORMAT_VERSION = 1
export const SIDECAR_VERSION = 1
export const MIN_PASSWORD = 6

export type ArchiveKind = "backup" | "export"
export type Protection = "none" | "key" | "password"
export type AssetKind = "PROPERTY" | "VEHICLE" | "EQUIPMENT" | "PERSON"

/** What an export covers. Backups always cover everything. */
export type ExportScope =
  | { kind: "all"; includeHealth: boolean }
  | { kind: "asset"; assetType: AssetKind; assetId: string }

export type ManifestFile = { path: string; size: number; sha256: string }

export type Manifest = {
  formatVersion: number
  kind: ArchiveKind
  scope: ExportScope | null
  appVersion: string
  /** Latest applied Prisma migration in the snapshot; null for exports. */
  migration: string | null
  createdAt: string
  protection: Protection
  counts: Record<string, number>
  /** Every entry except manifest.json itself. */
  files: ManifestFile[]
  warnings: string[]
  hasReadable: boolean
  hasSecrets: boolean
}

/** Plaintext next to every archive: enough to list and check it without opening it. No record content. */
export type Sidecar = {
  sidecarVersion: number
  file: string
  createdAt: string
  kind: ArchiveKind
  size: number
  sha256: string
  appVersion: string
  migration: string | null
  protection: Protection
  keyFingerprint: string | null
  warningCount: number
}

export const MANIFEST_ENTRY = "manifest.json"
export const DB_ENTRY = "db/homecenter.db"
export const SECRETS_ENTRY = "secrets.json"
export const FILES_PREFIX = "files/"
export const READABLE_PREFIX = "readable/"
export const SIDECAR_SUFFIX = ".meta.json"

const BACKUP_EXT: Record<Protection, string> = { none: ".hcbackup", key: ".hcbackup.age", password: ".hcbackup.zip" }

const pad = (n: number) => String(n).padStart(2, "0")

/** Local time: a 03:00 backup should read 0300 on the server it ran on. */
export function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

export function archiveName(kind: ArchiveKind, d: Date, protection: Protection): string {
  if (kind === "export") return `homecenter-export-${stamp(d)}.zip`
  return `homecenter-${stamp(d)}${BACKUP_EXT[protection]}`
}

/** The plain archive's name inside a protected one. */
export function innerName(file: string): string {
  if (file.endsWith(".hcbackup.age")) return file.slice(0, -".age".length)
  if (file.endsWith(".hcbackup.zip")) return file.slice(0, -".zip".length)
  if (file.endsWith(".zip")) return `${file.slice(0, -".zip".length)}-inner.zip`
  return file
}

export function protectionOfName(file: string): Protection | null {
  if (file.endsWith(".hcbackup.age")) return "key"
  if (file.endsWith(".hcbackup.zip")) return "password"
  if (file.endsWith(".hcbackup")) return "none"
  return null
}
```

- [ ] **Step 5: Implement `lib/backup/paths.ts`**

```ts
// Engine file: relative imports and npm packages only.
import path from "node:path"
import { readdir, stat } from "node:fs/promises"

type Env = Record<string, string | undefined>

export function dbPathFromUrl(url: string | undefined): string {
  const p = (url ?? "").replace(/^file:/, "")
  if (!p) throw new Error("DATABASE_URL is not set")
  return path.resolve(p)
}

export const dataDir = (env: Env = process.env) => path.dirname(dbPathFromUrl(env.DATABASE_URL))
export const uploadDir = (env: Env = process.env) => path.resolve(env.UPLOAD_DIR ?? "./uploads")
export const restoreDir = (env: Env = process.env) => path.join(dataDir(env), "restore")
/** Scratch space for snapshots and plaintext archives; same disk as the live data on purpose. */
export const workDir = (env: Env = process.env) => path.join(dataDir(env), "backup-work")
export const defaultBackupFolder = (env: Env = process.env) => path.join(dataDir(env), "backups")

/** Same rule as lib/documents/index-db.ts searchIndexPath(); duplicated because engine files can't import @/. */
export function searchIndexFile(env: Env = process.env): string {
  if (env.SEARCH_INDEX_PATH) return path.resolve(env.SEARCH_INDEX_PATH)
  return path.join(dataDir(env), "search-index.db")
}

/** libsql wants forward slashes, also on Windows. */
export const fileUrl = (p: string) => "file:" + p.replace(/\\/g, "/")

/** A path inside root for an archive-relative path, or null if it would escape. */
export function safeJoin(root: string, rel: string): string | null {
  if (!rel || rel.includes("\\") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null
  const parts = rel.split("/")
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null
  const full = path.resolve(root, ...parts)
  return full.startsWith(path.resolve(root) + path.sep) ? full : null
}

/** Migration folder names this build knows, oldest first. */
export async function appMigrations(dir = path.join(process.cwd(), "prisma", "migrations")): Promise<string[]> {
  const names = await readdir(dir)
  const out: string[] = []
  for (const n of names) {
    try {
      if ((await stat(path.join(dir, n, "migration.sql"))).isFile()) out.push(n)
    } catch {
      // not a migration folder (e.g. migration_lock.toml)
    }
  }
  return out.sort()
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/backup/format.test.ts lib/backup/paths.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/backup/format.ts lib/backup/paths.ts lib/backup/format.test.ts lib/backup/paths.test.ts
git commit -m "Add backup archive format types and data paths"
```

---

### Task 2: Streaming archive writer and reader, plus the engine import rule

**Files:**
- Create: `lib/backup/archive.ts`, `lib/backup/test-support.ts`
- Test: `lib/backup/archive.test.ts`, `lib/backup/import-rules.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `ManifestFile`, `MANIFEST_ENTRY`, `safeJoin` (Task 1)
- Produces:
  - `class ArchiveWriter { static create(finalPath: string, opts?: { password?: string }): Promise<ArchiveWriter>; addFile(entry: string, src: string, opts?: { compress?: boolean }): Promise<ManifestFile>; addBytes(entry: string, data: string | Uint8Array, opts?: { compress?: boolean }): Promise<ManifestFile>; finish(meta: Omit<Manifest, "files">): Promise<{ path: string; manifest: Manifest }>; abort(): Promise<void> }`
  - `class ArchiveReader { static open(p: string, password?: string): Promise<ArchiveReader>; entries(): string[]; readText(entry: string): Promise<string>; hash(entry: string): Promise<{ size: number; sha256: string }>; extract(entry: string, dest: string): Promise<void>; manifest(): Promise<Manifest>; close(): Promise<void> }`
  - `hashFile(p: string): Promise<{ size: number; sha256: string }>`
  - test-support: `tempDir(prefix?: string): Promise<string>`, `writeFiles(root: string, files: Record<string, string>): Promise<void>`

- [ ] **Step 1: Write `lib/backup/test-support.ts` (helpers for tests, not a test file)**

```ts
// Test helpers only. Not imported by app code.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function tempDir(prefix = "hc-backup-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"))
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, body)
  }
}
```

- [ ] **Step 2: Write the failing tests**

`lib/backup/archive.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { ArchiveReader, ArchiveWriter, hashFile } from "./archive"
import { FORMAT_VERSION, type Manifest } from "./format"
import { tempDir, writeFiles } from "./test-support"

const meta = (): Omit<Manifest, "files"> => ({
  formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: "test", migration: "m1",
  createdAt: new Date(0).toISOString(), protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false,
})
const sha = (s: string) => createHash("sha256").update(s).digest("hex")

describe("ArchiveWriter / ArchiveReader", () => {
  it("round-trips files and bytes with checksums in the manifest", async () => {
    const dir = await tempDir()
    await writeFiles(dir, { "src/a.txt": "alpha" })
    const out = path.join(dir, "x.hcbackup")
    const w = await ArchiveWriter.create(out)
    await w.addFile("files/a.txt", path.join(dir, "src/a.txt"))
    await w.addBytes("note.txt", "beta")
    const { manifest } = await w.finish(meta())
    expect(existsSync(out)).toBe(true)
    expect(existsSync(out + ".partial")).toBe(false)
    expect(manifest.files).toEqual([
      { path: "files/a.txt", size: 5, sha256: sha("alpha") },
      { path: "note.txt", size: 4, sha256: sha("beta") },
    ])

    const r = await ArchiveReader.open(out)
    expect(r.entries().sort()).toEqual(["files/a.txt", "manifest.json", "note.txt"])
    expect(await r.readText("note.txt")).toBe("beta")
    expect(await r.hash("files/a.txt")).toEqual({ size: 5, sha256: sha("alpha") })
    expect((await r.manifest()).files).toHaveLength(2)
    await r.extract("files/a.txt", path.join(dir, "out/a.txt"))
    expect(await readFile(path.join(dir, "out/a.txt"), "utf8")).toBe("alpha")
    await r.close()
  })

  it("abort removes the partial file and leaves no archive", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "y.hcbackup")
    const w = await ArchiveWriter.create(out)
    await w.addBytes("a", "a")
    await w.abort()
    expect(existsSync(out)).toBe(false)
    expect(existsSync(out + ".partial")).toBe(false)
  })

  it("writes and reads a password-protected zip", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "p.zip")
    const w = await ArchiveWriter.create(out, { password: "abcdef" })
    await w.addBytes("inner.hcbackup", "secret stuff")
    await w.finish(meta())
    await expect(ArchiveReader.open(out, "wrong1").then((r) => r.readText("inner.hcbackup"))).rejects.toThrow()
    const r = await ArchiveReader.open(out, "abcdef")
    expect(await r.readText("inner.hcbackup")).toBe("secret stuff")
    await r.close()
  })

  it("hashFile matches the content", async () => {
    const dir = await tempDir()
    await writeFiles(dir, { "f": "hello" })
    expect(await hashFile(path.join(dir, "f"))).toEqual({ size: 5, sha256: sha("hello") })
  })
})
```

`lib/backup/import-rules.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// scripts/restore-apply.ts runs these files with tsx inside the Docker runner,
// which has no @/ app sources. Type-only imports are erased, so they are fine.
const root = path.resolve(__dirname, "../..")
const engine = readdirSync(path.join(root, "lib/backup"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith("-server.ts") && !f.endsWith(".test.ts") && f !== "test-support.ts")
  .map((f) => `lib/backup/${f}`)
const scripts = readdirSync(path.join(root, "scripts")).filter((f) => /^(backup|restore)/.test(f)).map((f) => `scripts/${f}`)
const helpers = ["lib/attachment-location.ts", "lib/secret-box.ts"]

describe("engine import rule", () => {
  it.each([...engine, ...scripts, ...helpers])("%s imports no @/ at runtime", (file) => {
    const src = readFileSync(path.join(root, file), "utf8")
    const runtime = src.split("\n").filter((l) => /from\s+["']@\//.test(l) && !/^\s*import\s+type\b/.test(l))
    expect(runtime).toEqual([])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/backup/archive.test.ts lib/backup/import-rules.test.ts`
Expected: archive tests FAIL ("Failed to resolve import ./archive"); import-rules PASS for the files that exist.

- [ ] **Step 4: Implement `lib/backup/archive.ts`**

```ts
// Engine file: relative imports and npm packages only.
// Every archive is a zip written and read as a stream (zip.js, ZIP64), so a
// multi-gigabyte upload folder never sits in memory.
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, open, rename, rm, type FileHandle } from "node:fs/promises"
import path from "node:path"
import { Readable, Writable } from "node:stream"
import { createHash } from "node:crypto"
import { configure, Reader, TextWriter, Uint8ArrayReader, ZipReader, ZipWriter, type Entry } from "@zip.js/zip.js"
import { MANIFEST_ENTRY, type Manifest, type ManifestFile } from "./format"

configure({ useWebWorkers: false })

const encode = (s: string) => new TextEncoder().encode(s)

function hashing() {
  const h = createHash("sha256")
  let size = 0
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      h.update(chunk)
      size += chunk.byteLength
      ctl.enqueue(chunk)
    },
  })
  return { stream, result: () => ({ size, sha256: h.digest("hex") }) }
}

export async function hashFile(p: string): Promise<{ size: number; sha256: string }> {
  const h = createHash("sha256")
  let size = 0
  for await (const chunk of createReadStream(p)) {
    h.update(chunk as Buffer)
    size += (chunk as Buffer).byteLength
  }
  return { size, sha256: h.digest("hex") }
}

export class ArchiveWriter {
  private files: ManifestFile[] = []
  private closed = false

  private constructor(
    private finalPath: string,
    private partialPath: string,
    private zip: ZipWriter<unknown>,
  ) {}

  /** Writes to `<finalPath>.partial`; finish() renames it into place. */
  static async create(finalPath: string, opts: { password?: string } = {}): Promise<ArchiveWriter> {
    await mkdir(path.dirname(finalPath), { recursive: true })
    const partialPath = finalPath + ".partial"
    const out = Writable.toWeb(createWriteStream(partialPath)) as WritableStream<Uint8Array>
    const zip = new ZipWriter(out, {
      zip64: true,
      level: 0,
      ...(opts.password ? { password: opts.password, encryptionStrength: 3 as const } : {}),
    })
    return new ArchiveWriter(finalPath, partialPath, zip)
  }

  async addFile(entry: string, src: string, opts: { compress?: boolean } = {}): Promise<ManifestFile> {
    const h = hashing()
    const input = (Readable.toWeb(createReadStream(src)) as ReadableStream<Uint8Array>).pipeThrough(h.stream)
    await this.zip.add(entry, input, { level: opts.compress ? 6 : 0 })
    const file = { path: entry, ...h.result() }
    this.files.push(file)
    return file
  }

  async addBytes(entry: string, data: string | Uint8Array, opts: { compress?: boolean } = { compress: true }): Promise<ManifestFile> {
    const bytes = typeof data === "string" ? encode(data) : data
    await this.zip.add(entry, new Uint8ArrayReader(bytes), { level: opts.compress ? 6 : 0 })
    const file = { path: entry, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }
    this.files.push(file)
    return file
  }

  async finish(meta: Omit<Manifest, "files">): Promise<{ path: string; manifest: Manifest }> {
    const manifest: Manifest = { ...meta, files: this.files }
    await this.zip.add(MANIFEST_ENTRY, new Uint8ArrayReader(encode(JSON.stringify(manifest, null, 2))), { level: 6 })
    await this.zip.close()
    this.closed = true
    await rename(this.partialPath, this.finalPath)
    return { path: this.finalPath, manifest }
  }

  async abort(): Promise<void> {
    if (!this.closed) {
      try {
        await this.zip.close()
      } catch {
        // already broken; the partial file goes either way
      }
    }
    await rm(this.partialPath, { force: true })
  }
}

/** zip.js needs random access; this reads straight from the file. */
class FileReader extends Reader<string> {
  private fh: FileHandle | null = null
  constructor(private p: string) {
    super(p)
  }
  async init() {
    this.fh = await open(this.p)
    this.size = (await this.fh.stat()).size
  }
  async readUint8Array(index: number, length: number): Promise<Uint8Array> {
    const b = Buffer.alloc(length)
    await this.fh!.read(b, 0, length, index)
    return new Uint8Array(b.buffer, b.byteOffset, length)
  }
  async closeFile() {
    await this.fh?.close()
    this.fh = null
  }
}

export class ArchiveReader {
  private constructor(
    private file: FileReader,
    private zip: ZipReader<unknown>,
    private byName: Map<string, Entry>,
  ) {}

  static async open(p: string, password?: string): Promise<ArchiveReader> {
    const file = new FileReader(p)
    const zip = new ZipReader(file, password ? { password } : {})
    try {
      const entries = await zip.getEntries()
      return new ArchiveReader(file, zip, new Map(entries.filter((e) => !e.directory).map((e) => [e.filename, e])))
    } catch (e) {
      await file.closeFile()
      throw e
    }
  }

  entries(): string[] {
    return [...this.byName.keys()]
  }

  private entry(name: string): Entry {
    const e = this.byName.get(name)
    if (!e || !e.getData) throw new Error(`Not in archive: ${name}`)
    return e
  }

  async readText(name: string): Promise<string> {
    return this.entry(name).getData!(new TextWriter())
  }

  async hash(name: string): Promise<{ size: number; sha256: string }> {
    const h = createHash("sha256")
    let size = 0
    await this.entry(name).getData!(
      new WritableStream<Uint8Array>({
        write(chunk) {
          h.update(chunk)
          size += chunk.byteLength
        },
      }),
    )
    return { size, sha256: h.digest("hex") }
  }

  /** dest must already be a safe, caller-checked path. */
  async extract(name: string, dest: string): Promise<void> {
    await mkdir(path.dirname(dest), { recursive: true })
    await this.entry(name).getData!(Writable.toWeb(createWriteStream(dest)) as WritableStream<Uint8Array>)
  }

  async manifest(): Promise<Manifest> {
    if (!this.byName.has(MANIFEST_ENTRY)) throw new Error("No manifest.json: not a HomeCenter archive.")
    return JSON.parse(await this.readText(MANIFEST_ENTRY)) as Manifest
  }

  async close(): Promise<void> {
    await this.zip.close()
    await this.file.closeFile()
  }
}
```

If `tsc` rejects a zip.js type name (`Entry`, `Reader<string>` generics), check `node_modules/@zip.js/zip.js/index.d.ts` and adjust the type only; behaviour was proven in the 2026-10-11 spike.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/backup/archive.test.ts lib/backup/import-rules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/backup/archive.ts lib/backup/test-support.ts lib/backup/archive.test.ts lib/backup/import-rules.test.ts
git commit -m "Add streaming archive writer and reader for backups"
```

---

### Task 3: Snapshot and verification

**Files:**
- Create: `lib/backup/snapshot.ts`, `lib/backup/verify.ts`
- Modify: `lib/backup/test-support.ts` (migrated DB + sample seed)
- Test: `lib/backup/snapshot.test.ts`, `lib/backup/verify.test.ts`

**Interfaces:**
- Consumes: `ArchiveWriter`, `ArchiveReader` (Task 2); `fileUrl`, `appMigrations`, `DB_ENTRY`, `Manifest`, `FORMAT_VERSION` (Task 1); `attachmentDir` from `../attachment-location`
- Produces:
  - `openDb(p: string): Client`
  - `vacuumInto(dbPath: string, dest: string): Promise<void>`
  - `referencedFiles(dbPath: string): Promise<{ files: string[]; skipped: string[] }>` (posix paths relative to the upload root)
  - `latestMigration(dbPath: string): Promise<string | null>`
  - `COUNTED_MODELS: readonly string[]`, `modelCounts(dbPath: string): Promise<Record<string, number>>`
  - `integrityCheck(dbPath: string): Promise<string>` ("ok" when fine)
  - `type VerifyResult = { ok: true; manifest: Manifest } | { ok: false; error: string }`
  - `verifyArchive(plainPath: string, opts: { workDir: string; password?: string }): Promise<VerifyResult>`
  - `type Compat = { ok: true } | { ok: false; reason: string }`, `checkCompatibility(manifest: Manifest, known: string[]): Compat`
  - test-support: `createMigratedDb(dbPath: string, opts?: { upTo?: string }): Promise<void>`, `seedSample(dbPath: string, uploadRoot: string): Promise<void>`, `SAMPLE_FILES: string[]`

- [ ] **Step 1: Extend `lib/backup/test-support.ts`**

Append:
```ts
import { readFile } from "node:fs/promises"
import { createClient } from "@libsql/client"
import { appMigrations, fileUrl } from "./paths"

/** A fresh DB with every migration applied (or up to and including upTo), recorded in _prisma_migrations like `prisma migrate deploy` does. */
export async function createMigratedDb(dbPath: string, opts: { upTo?: string } = {}): Promise<void> {
  const dir = path.resolve(__dirname, "../../prisma/migrations")
  const names = (await appMigrations(dir)).filter((n) => !opts.upTo || n <= opts.upTo)
  const c = createClient({ url: fileUrl(dbPath) })
  try {
    await c.execute(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL, "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL, "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`)
    for (const n of names) {
      await c.executeMultiple(await readFile(path.join(dir, n, "migration.sql"), "utf8"))
      await c.execute({ sql: `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, 'x', current_timestamp, ?, 1)`, args: [n, n] })
    }
  } finally {
    c.close()
  }
}

/** Upload paths seedSample writes, relative to the upload root. */
export const SAMPLE_FILES = ["service/s1/f-a1.pdf", "service/s2/f-a2.pdf", "properties/p1/img-p1.jpg"]

/** Two assets, one person with a health record, records and files. Synthetic only. */
export async function seedSample(dbPath: string, uploadRoot: string): Promise<void> {
  const t = "2026-01-01T00:00:00.000Z"
  const c = createClient({ url: fileUrl(dbPath) })
  try {
    await c.executeMultiple(`
      INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('u1', 'Admin', 'admin@example.test', 'hash', 'ADMIN');
      INSERT INTO "Property" (id, name, address, imageFilename, updatedAt) VALUES ('p1', 'Main House', '1 Elm St', 'img-p1.jpg', '${t}');
      INSERT INTO "Vehicle" (id, name, make, model, year, updatedAt) VALUES ('v1', 'Daily Driver', 'Honda', 'Fit', 2015, '${t}');
      INSERT INTO "Person" (id, name, updatedAt) VALUES ('h1', 'Pat', '${t}');
      INSERT INTO "Medication" (id, name, personId, updatedAt) VALUES ('m1', 'Ibuprofen', 'h1', '${t}');
      INSERT INTO "ServiceRecord" (id, assetId, assetType, date, title, cost, createdById, updatedAt) VALUES
        ('s1', 'v1', 'VEHICLE', '2026-02-01T00:00:00.000Z', 'Oil change', 49.5, 'u1', '${t}'),
        ('s2', 'h1', 'PERSON', '2026-03-01T00:00:00.000Z', 'Checkup', 0, 'u1', '${t}');
      INSERT INTO "Attachment" (id, recordType, filename, originalName, mimeType, sizeBytes, uploadedById, serviceRecordId) VALUES
        ('a1', 'SERVICE', 'f-a1.pdf', 'receipt.pdf', 'application/pdf', 5, 'u1', 's1'),
        ('a2', 'SERVICE', 'f-a2.pdf', 'visit.pdf', 'application/pdf', 5, 'u1', 's2');
    `)
  } finally {
    c.close()
  }
  await writeFiles(uploadRoot, Object.fromEntries(SAMPLE_FILES.map((f) => [f, `data:${f}`])))
}
```
Move the new imports to the top of the file. If an INSERT fails with "NOT NULL constraint failed: X.col", add that column with a plain value; the migration SQL in `prisma/migrations` is the source of truth.

- [ ] **Step 2: Write the failing tests**

`lib/backup/snapshot.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"
import { integrityCheck, latestMigration, modelCounts, referencedFiles, vacuumInto } from "./snapshot"
import { appMigrations } from "./paths"

describe("snapshot", () => {
  it("copies a consistent snapshot and reads what it references", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const snap = path.join(dir, "snap.db")
    await vacuumInto(db, snap)
    expect(await integrityCheck(snap)).toBe("ok")
    expect((await referencedFiles(snap)).files).toEqual([...SAMPLE_FILES].sort())
    expect(await latestMigration(snap)).toBe((await appMigrations()).at(-1))
    const counts = await modelCounts(snap)
    expect(counts).toMatchObject({ User: 1, Property: 1, Vehicle: 1, Person: 1, ServiceRecord: 2, Attachment: 2, Medication: 1 })
  })

  it("skips a stored filename that would escape the upload root", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "live.db")
    await createMigratedDb(db)
    await seedSample(db, path.join(dir, "uploads"))
    const { openDb } = await import("./snapshot")
    const c = openDb(db)
    await c.execute(`UPDATE "Attachment" SET filename = '../../evil' WHERE id = 'a1'`)
    c.close()
    const r = await referencedFiles(db)
    expect(r.files).not.toContain("service/s1/../../evil")
    expect(r.skipped).toEqual(["service/s1/../../evil"])
  })
})
```

`lib/backup/verify.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { writeFile } from "node:fs/promises"
import { ArchiveWriter } from "./archive"
import { checkCompatibility, verifyArchive } from "./verify"
import { createMigratedDb, tempDir } from "./test-support"
import { vacuumInto } from "./snapshot"
import { DB_ENTRY, FORMAT_VERSION, type Manifest } from "./format"

const meta = (over: Partial<Manifest> = {}): Omit<Manifest, "files"> => ({
  formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: "t", migration: "20260101000000_a",
  createdAt: new Date(0).toISOString(), protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false, ...over,
})

async function goodArchive(dir: string) {
  const db = path.join(dir, "live.db")
  await createMigratedDb(db)
  const snap = path.join(dir, "snap.db")
  await vacuumInto(db, snap)
  const out = path.join(dir, "ok.hcbackup")
  const w = await ArchiveWriter.create(out)
  await w.addFile(DB_ENTRY, snap)
  await w.addBytes("files/x.txt", "x")
  await w.finish(meta())
  return out
}

describe("verifyArchive", () => {
  it("accepts a good archive", async () => {
    const dir = await tempDir()
    const r = await verifyArchive(await goodArchive(dir), { workDir: dir })
    expect(r.ok).toBe(true)
  })

  it("refuses a zip without a manifest", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "plain.zip")
    // An ordinary zip, written directly with zip.js.
    const { ZipWriter, Uint8ArrayReader } = await import("@zip.js/zip.js")
    const chunks: Uint8Array[] = []
    const zw = new ZipWriter(new WritableStream<Uint8Array>({ write: (c) => void chunks.push(c) }))
    await zw.add("a.txt", new Uint8ArrayReader(new TextEncoder().encode("a")))
    await zw.close()
    await writeFile(out, Buffer.concat(chunks))
    expect(await verifyArchive(out, { workDir: dir })).toEqual({ ok: false, error: "No manifest.json: not a HomeCenter archive." })
  })

  it("refuses a file that is not a zip", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "junk.hcbackup")
    await writeFile(out, "not a zip")
    expect(await verifyArchive(out, { workDir: dir })).toMatchObject({ ok: false, error: "Not a HomeCenter archive (it can't be opened as a zip)." })
  })

  it("refuses an archive from a newer format", async () => {
    const dir = await tempDir()
    const out = path.join(dir, "new.hcbackup")
    const w = await ArchiveWriter.create(out)
    await w.finish(meta({ formatVersion: FORMAT_VERSION + 1, kind: "export" }))
    expect(await verifyArchive(out, { workDir: dir })).toMatchObject({ ok: false, error: expect.stringContaining("newer HomeCenter") })
  })
})

describe("checkCompatibility", () => {
  const known = ["20260101000000_a", "20260201000000_b"]
  const m = (over: Partial<Manifest>) => ({ ...meta(over), files: [] }) as Manifest
  it("accepts a known migration", () => expect(checkCompatibility(m({ migration: "20260101000000_a" }), known)).toEqual({ ok: true }))
  it("refuses an export", () => expect(checkCompatibility(m({ kind: "export" }), known)).toMatchObject({ ok: false, reason: expect.stringContaining("export") }))
  it("refuses a newer migration", () =>
    expect(checkCompatibility(m({ migration: "20270101000000_z" }), known)).toMatchObject({ ok: false, reason: expect.stringContaining("Update HomeCenter first") }))
  it("refuses an unknown older migration", () =>
    expect(checkCompatibility(m({ migration: "20260115000000_fork" }), known)).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't know") }))
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/backup/snapshot.test.ts lib/backup/verify.test.ts`
Expected: FAIL, cannot resolve `./snapshot` / `./verify`.

- [ ] **Step 4: Implement `lib/backup/snapshot.ts`**

```ts
// Engine file: relative imports and npm packages only.
import { rm } from "node:fs/promises"
import { createClient, type Client } from "@libsql/client"
import { attachmentDir, type AttachmentLocation } from "../attachment-location"
import { fileUrl } from "./paths"

export const openDb = (p: string): Client => createClient({ url: fileUrl(p) })

async function withDb<T>(p: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = openDb(p)
  try {
    return await fn(c)
  } finally {
    c.close()
  }
}

/** A transactionally consistent copy, safe while the app keeps writing. */
export async function vacuumInto(dbPath: string, dest: string): Promise<void> {
  await rm(dest, { force: true })
  await withDb(dbPath, (c) => c.execute({ sql: "VACUUM INTO ?", args: [dest] }).then(() => undefined))
}

export async function integrityCheck(dbPath: string): Promise<string> {
  return withDb(dbPath, async (c) => {
    const r = await c.execute("PRAGMA integrity_check")
    return r.rows.map((row) => String(row[0])).join("; ")
  })
}

const IMAGE_DIRS: [table: string, dir: string][] = [["Property", "properties"], ["Vehicle", "vehicles"], ["Equipment", "equipment"], ["Person", "people"]]
const SEGMENT = /^[^/\\]+$/

/** Upload paths (posix, relative to the upload root) that the DB points at. Read from the snapshot so DB and files agree. */
export async function referencedFiles(dbPath: string): Promise<{ files: string[]; skipped: string[] }> {
  return withDb(dbPath, async (c) => {
    const files = new Set<string>()
    const skipped: string[] = []
    const add = (dir: string, id: string, name: string) => {
      const rel = `${dir}/${id}/${name}`
      if (SEGMENT.test(dir) && SEGMENT.test(id) && SEGMENT.test(name) && name !== ".." && name !== ".") files.add(rel)
      else skipped.push(rel)
    }
    const att = await c.execute(`SELECT recordType, filename, serviceRecordId, warrantyId, maintenanceScheduleId, healthConditionId,
      insurancePolicyId, observationId, medicationId, allergyId, immunizationId, assetId, inboxItemId FROM "Attachment"`)
    for (const row of att.rows) {
      const dir = attachmentDir(row as unknown as AttachmentLocation)
      if (dir) add(dir[0], dir[1], String(row.filename))
    }
    for (const [table, dir] of IMAGE_DIRS) {
      const r = await c.execute(`SELECT id, imageFilename FROM "${table}" WHERE imageFilename IS NOT NULL AND imageFilename <> ''`)
      for (const row of r.rows) add(dir, String(row.id), String(row.imageFilename))
    }
    return { files: [...files].sort(), skipped }
  })
}

export async function latestMigration(dbPath: string): Promise<string | null> {
  return withDb(dbPath, async (c) => {
    const r = await c.execute(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`)
    return r.rows[0] ? String(r.rows[0].migration_name) : null
  })
}

export const COUNTED_MODELS = [
  "User", "Property", "Vehicle", "Equipment", "Person", "Provider", "ServiceRecord", "Warranty", "MaintenanceSchedule",
  "InsurancePolicy", "HealthCondition", "Observation", "Medication", "Allergy", "Immunization", "Attachment", "InboxItem",
] as const

export async function modelCounts(dbPath: string): Promise<Record<string, number>> {
  return withDb(dbPath, async (c) => {
    const out: Record<string, number> = {}
    for (const m of COUNTED_MODELS) {
      try {
        const r = await c.execute(`SELECT COUNT(*) AS n FROM "${m}"`)
        out[m] = Number(r.rows[0].n)
      } catch {
        out[m] = 0 // table absent in an older schema
      }
    }
    return out
  })
}
```

- [ ] **Step 5: Implement `lib/backup/verify.ts`**

```ts
// Engine file: relative imports and npm packages only.
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { ArchiveReader } from "./archive"
import { DB_ENTRY, FORMAT_VERSION, type Manifest } from "./format"
import { integrityCheck } from "./snapshot"

export type VerifyResult = { ok: true; manifest: Manifest } | { ok: false; error: string }

/** Every listed entry present with the right size and hash; a backup's database passes integrity_check. */
export async function verifyArchive(plainPath: string, opts: { workDir: string; password?: string }): Promise<VerifyResult> {
  let r: ArchiveReader
  try {
    r = await ArchiveReader.open(plainPath, opts.password)
  } catch {
    return { ok: false, error: "Not a HomeCenter archive (it can't be opened as a zip)." }
  }
  try {
    let manifest: Manifest
    try {
      manifest = await r.manifest()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    if (manifest.formatVersion > FORMAT_VERSION) {
      return { ok: false, error: `Made by a newer HomeCenter (archive format ${manifest.formatVersion}). Update HomeCenter first.` }
    }
    const names = new Set(r.entries())
    for (const f of manifest.files) {
      if (!names.has(f.path)) return { ok: false, error: `Missing from the archive: ${f.path}` }
      const got = await r.hash(f.path)
      if (got.size !== f.size || got.sha256 !== f.sha256) return { ok: false, error: `Damaged in the archive: ${f.path}` }
    }
    if (manifest.kind === "backup") {
      if (!names.has(DB_ENTRY)) return { ok: false, error: "The backup has no database." }
      await mkdir(opts.workDir, { recursive: true })
      const tmp = path.join(opts.workDir, `verify-${randomUUID()}.db`)
      try {
        await r.extract(DB_ENTRY, tmp)
        const ic = await integrityCheck(tmp)
        if (ic !== "ok") return { ok: false, error: `The backup's database failed its check: ${ic}` }
      } finally {
        await rm(tmp, { force: true })
      }
    }
    return { ok: true, manifest }
  } finally {
    await r.close()
  }
}

export type Compat = { ok: true } | { ok: false; reason: string }

/** Older backups are upgraded by migrations at boot; newer or unknown ones are refused. */
export function checkCompatibility(manifest: Manifest, known: string[]): Compat {
  if (manifest.kind !== "backup") return { ok: false, reason: "This is an export. Exports can be browsed but not restored." }
  if (!manifest.migration) return { ok: false, reason: "This backup doesn't say which database version it holds." }
  if (known.includes(manifest.migration)) return { ok: true }
  const latest = known.at(-1) ?? ""
  return manifest.migration > latest
    ? { ok: false, reason: "This backup was made by a newer HomeCenter. Update HomeCenter first, then restore." }
    : { ok: false, reason: "This backup holds a database version this HomeCenter doesn't know." }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/backup`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/backup/snapshot.ts lib/backup/verify.ts lib/backup/test-support.ts lib/backup/snapshot.test.ts lib/backup/verify.test.ts
git commit -m "Add consistent DB snapshot and archive verification"
```

---

### Task 4: Backup engine and backup folder store

**Files:**
- Create: `lib/backup/store.ts`, `lib/backup/backup.ts`
- Test: `lib/backup/store.test.ts`, `lib/backup/backup.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - store: `sidecarPath(archivePath)`, `writeSidecar(archivePath, s: Sidecar)`, `readSidecar(p): Promise<Sidecar | null>`, `type StoredBackup = Sidecar & { path: string }`, `listBackups(folder): Promise<StoredBackup[]>` (newest first, kind backup and export), `pruneBackups(folder, keep): Promise<string[]>`, `deleteBackup(folder, file): Promise<boolean>`, `uniqueName(folder, name): Promise<string>`, `cleanupPartials(folder): Promise<number>`, `type FolderStatus = { exists: boolean; writable: boolean; freeBytes: number | null; sameDevice: boolean }`, `folderStatus(folder, dataDirPath): Promise<FolderStatus>`
  - backup: `type ProtectionConfig = { mode: "none" } | { mode: "key"; recipient: string; fingerprint: string } | { mode: "password"; password: string }`, `type Secrets = { mailPassword: string | null; llmApiKey: string | null }`, `type BackupInput = { dbPath; uploadDir; folder; workDir; appVersion: string; protection: ProtectionConfig; secrets?: Secrets | null; now?: Date; createFolder?: boolean; onProgress?: (done: number, total: number) => void; readable?: (snapshotPath: string, w: ArchiveWriter) => Promise<void> }`, `type BackupOutcome = { file: string; path: string; sidecar: Sidecar; warnings: string[] }`, `createBackup(input): Promise<BackupOutcome>`

- [ ] **Step 1: Write the failing tests**

`lib/backup/store.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { cleanupPartials, folderStatus, listBackups, pruneBackups, uniqueName, writeSidecar } from "./store"
import { SIDECAR_VERSION, type Sidecar } from "./format"
import { tempDir, writeFiles } from "./test-support"

const side = (file: string, createdAt: string, kind: "backup" | "export" = "backup"): Sidecar => ({
  sidecarVersion: SIDECAR_VERSION, file, createdAt, kind, size: 1, sha256: "x", appVersion: "t", migration: "m",
  protection: "none", keyFingerprint: null, warningCount: 0,
})

async function put(folder: string, file: string, createdAt: string, kind: "backup" | "export" = "backup") {
  await writeFiles(folder, { [file]: "z" })
  await writeSidecar(path.join(folder, file), side(file, createdAt, kind))
}

describe("backup folder", () => {
  it("lists only archives with a valid sidecar, newest first", async () => {
    const f = await tempDir()
    await put(f, "homecenter-2026-01-01-0300.hcbackup", "2026-01-01T03:00:00.000Z")
    await put(f, "homecenter-2026-01-02-0300.hcbackup", "2026-01-02T03:00:00.000Z")
    await writeFiles(f, { "notes.txt": "mine", "orphan.hcbackup.meta.json": "{bad" })
    expect((await listBackups(f)).map((b) => b.file)).toEqual(["homecenter-2026-01-02-0300.hcbackup", "homecenter-2026-01-01-0300.hcbackup"])
  })

  it("retention never deletes non-backup files", async () => {
    const f = await tempDir()
    for (let d = 1; d <= 4; d++) await put(f, `homecenter-2026-01-0${d}-0300.hcbackup`, `2026-01-0${d}T03:00:00.000Z`)
    await writeFiles(f, { "notes.txt": "mine", "homecenter-2025-01-01-0300.hcbackup": "no sidecar, not ours to judge" })
    const deleted = await pruneBackups(f, 2)
    expect(deleted.sort()).toEqual(["homecenter-2026-01-01-0300.hcbackup", "homecenter-2026-01-02-0300.hcbackup"])
    const left = (await readdir(f)).sort()
    expect(left).toContain("notes.txt")
    expect(left).toContain("homecenter-2025-01-01-0300.hcbackup")
    expect(left).not.toContain("homecenter-2026-01-01-0300.hcbackup.meta.json")
  })

  it("numbers a second backup made in the same minute", async () => {
    const f = await tempDir()
    await put(f, "homecenter-2026-01-01-0300.hcbackup", "2026-01-01T03:00:00.000Z")
    expect(await uniqueName(f, "homecenter-2026-01-01-0300.hcbackup")).toBe("homecenter-2026-01-01-0300-2.hcbackup")
    expect(await uniqueName(f, "homecenter-2026-01-01-0300.hcbackup.age")).toBe("homecenter-2026-01-01-0300.hcbackup.age")
  })

  it("cleanupPartials removes leftovers from an interrupted run", async () => {
    const f = await tempDir()
    await writeFiles(f, { "a.hcbackup.partial": "x", "keep.hcbackup": "y" })
    expect(await cleanupPartials(f)).toBe(1)
    expect(existsSync(path.join(f, "keep.hcbackup"))).toBe(true)
  })

  it("reports folder status", async () => {
    const f = await tempDir()
    const s = await folderStatus(f, f)
    expect(s).toMatchObject({ exists: true, writable: true, sameDevice: true })
    expect((await folderStatus(path.join(f, "nope"), f)).exists).toBe(false)
  })
})
```

`lib/backup/backup.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readdir, rm } from "node:fs/promises"
import { createBackup } from "./backup"
import { ArchiveReader } from "./archive"
import { readSidecar } from "./store"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"

async function setup() {
  const dir = await tempDir()
  const dbPath = path.join(dir, "homecenter.db")
  const uploadDir = path.join(dir, "uploads")
  await createMigratedDb(dbPath)
  await seedSample(dbPath, uploadDir)
  return { dir, dbPath, uploadDir, folder: path.join(dir, "backups"), workDir: path.join(dir, "work") }
}

describe("createBackup", () => {
  it("writes a verified archive with db, referenced files and a sidecar", async () => {
    const s = await setup()
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "none" }, now: new Date(2026, 9, 11, 3, 0) })
    expect(out.file).toBe("homecenter-2026-10-11-0300.hcbackup")
    expect(out.warnings).toEqual([])
    const r = await ArchiveReader.open(out.path)
    const names = r.entries()
    expect(names).toContain("db/homecenter.db")
    for (const f of SAMPLE_FILES) expect(names).toContain(`files/${f}`)
    const m = await r.manifest()
    expect(m).toMatchObject({ kind: "backup", protection: "none", hasSecrets: false })
    expect(m.counts.ServiceRecord).toBe(2)
    await r.close()
    expect(await readSidecar(out.path + ".meta.json")).toMatchObject({ file: out.file, kind: "backup", size: out.sidecar.size })
    expect(await readdir(s.workDir)).toEqual([]) // snapshot cleaned up
  })

  it("succeeds with a warning when an upload is missing", async () => {
    const s = await setup()
    await rm(path.join(s.uploadDir, SAMPLE_FILES[0]))
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "none" } })
    expect(out.warnings).toEqual([`Missing file: ${SAMPLE_FILES[0]}`])
    expect(out.sidecar.warningCount).toBe(1)
  })

  it("refuses a folder that does not exist instead of creating it", async () => {
    const s = await setup()
    await expect(createBackup({ ...s, folder: path.join(s.dir, "unmounted", "share"), createFolder: false, appVersion: "t", protection: { mode: "none" } }))
      .rejects.toThrow("Backup folder not found")
    expect(existsSync(path.join(s.dir, "unmounted"))).toBe(false)
  })

  it("reports progress per file", async () => {
    const s = await setup()
    const seen: [number, number][] = []
    await createBackup({ ...s, appVersion: "t", protection: { mode: "none" }, onProgress: (d, t) => seen.push([d, t]) })
    expect(seen.at(-1)).toEqual([SAMPLE_FILES.length, SAMPLE_FILES.length])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/backup/store.test.ts lib/backup/backup.test.ts`
Expected: FAIL, cannot resolve `./store` / `./backup`.

- [ ] **Step 3: Implement `lib/backup/store.ts`**

```ts
// Engine file: relative imports and npm packages only.
// The backup folder is the source of truth for which backups exist: a sidecar
// next to each archive says what it is. Nothing without a valid sidecar is ever
// listed or deleted, so a shared folder's other files are safe.
import path from "node:path"
import { constants } from "node:fs"
import { access, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises"
import { SIDECAR_SUFFIX, SIDECAR_VERSION, type Sidecar } from "./format"

export const sidecarPath = (archivePath: string) => archivePath + SIDECAR_SUFFIX

export async function writeSidecar(archivePath: string, s: Sidecar): Promise<void> {
  await writeFile(sidecarPath(archivePath), JSON.stringify(s, null, 2))
}

export async function readSidecar(p: string): Promise<Sidecar | null> {
  try {
    const s = JSON.parse(await readFile(p, "utf8")) as Sidecar
    if (s.sidecarVersion !== SIDECAR_VERSION || typeof s.file !== "string" || path.basename(s.file) !== s.file) return null
    return s
  } catch {
    return null
  }
}

export type StoredBackup = Sidecar & { path: string }

export async function listBackups(folder: string): Promise<StoredBackup[]> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return []
  }
  const out: StoredBackup[] = []
  for (const n of names.filter((n) => n.endsWith(SIDECAR_SUFFIX))) {
    const s = await readSidecar(path.join(folder, n))
    if (!s || n !== s.file + SIDECAR_SUFFIX) continue
    const p = path.join(folder, s.file)
    try {
      if ((await stat(p)).isFile()) out.push({ ...s, path: p })
    } catch {
      // archive gone; ignore the stray sidecar
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Keeps the newest `keep` backups (exports are not counted or pruned). Returns deleted file names. */
export async function pruneBackups(folder: string, keep: number): Promise<string[]> {
  const old = (await listBackups(folder)).filter((b) => b.kind === "backup").slice(Math.max(0, keep))
  for (const b of old) {
    await rm(b.path, { force: true })
    await rm(sidecarPath(b.path), { force: true })
  }
  return old.map((b) => b.file)
}

export async function deleteBackup(folder: string, file: string): Promise<boolean> {
  const b = (await listBackups(folder)).find((x) => x.file === file)
  if (!b) return false
  await rm(b.path, { force: true })
  await rm(sidecarPath(b.path), { force: true })
  return true
}

const exists = (p: string) => stat(p).then(() => true, () => false)

/** name, or name with -2, -3… before the extension when taken. */
export async function uniqueName(folder: string, name: string): Promise<string> {
  if (!(await exists(path.join(folder, name)))) return name
  const m = /^(homecenter-(?:export-)?\d{4}-\d{2}-\d{2}-\d{4})(.*)$/.exec(name)
  const [base, ext] = m ? [m[1], m[2]] : [name, ""]
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`
    if (!(await exists(path.join(folder, candidate)))) return candidate
  }
}

export async function cleanupPartials(folder: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(folder)
  } catch {
    return 0
  }
  const partials = names.filter((n) => n.endsWith(".partial"))
  for (const n of partials) await rm(path.join(folder, n), { force: true })
  return partials.length
}

export type FolderStatus = { exists: boolean; writable: boolean; freeBytes: number | null; sameDevice: boolean }

export async function folderStatus(folder: string, dataDirPath: string): Promise<FolderStatus> {
  let st
  try {
    st = await stat(folder)
  } catch {
    return { exists: false, writable: false, freeBytes: null, sameDevice: false }
  }
  if (!st.isDirectory()) return { exists: false, writable: false, freeBytes: null, sameDevice: false }
  const writable = await access(folder, constants.W_OK).then(() => true, () => false)
  let freeBytes: number | null = null
  try {
    const fs = await statfs(folder)
    freeBytes = Number(fs.bavail) * Number(fs.bsize)
  } catch {
    freeBytes = null
  }
  const sameDevice = await stat(dataDirPath).then((d) => d.dev === st.dev, () => false)
  return { exists: true, writable, freeBytes, sameDevice }
}
```

- [ ] **Step 4: Implement `lib/backup/backup.ts`**

```ts
// Engine file: relative imports and npm packages only.
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
import { ArchiveWriter, hashFile } from "./archive"
import { archiveName, DB_ENTRY, FILES_PREFIX, FORMAT_VERSION, SECRETS_ENTRY, SIDECAR_VERSION, type Sidecar } from "./format"
import { safeJoin } from "./paths"
import { latestMigration, modelCounts, referencedFiles, vacuumInto } from "./snapshot"
import { uniqueName, writeSidecar } from "./store"
import { verifyArchive } from "./verify"

export type ProtectionConfig =
  | { mode: "none" }
  | { mode: "key"; recipient: string; fingerprint: string }
  | { mode: "password"; password: string }

export type Secrets = { mailPassword: string | null; llmApiKey: string | null }

export type BackupInput = {
  dbPath: string
  uploadDir: string
  folder: string
  workDir: string
  appVersion: string
  protection: ProtectionConfig
  /** Only written when protection is on: plaintext secrets never go in an open archive. */
  secrets?: Secrets | null
  now?: Date
  /** False for configured folders: a missing NAS mount must fail, not fill the local disk. Default true. */
  createFolder?: boolean
  onProgress?: (done: number, total: number) => void
  /** Adds readable/ (Task 16). Files are already in the archive under files/<rel>. */
  readable?: (snapshotPath: string, w: ArchiveWriter) => Promise<void>
}

export type BackupOutcome = { file: string; path: string; sidecar: Sidecar; warnings: string[] }

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false)
const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false)

export async function createBackup(input: BackupInput): Promise<BackupOutcome> {
  const now = input.now ?? new Date()
  const mode = input.protection.mode
  if (input.createFolder === false) {
    if (!(await isDir(input.folder))) throw new Error(`Backup folder not found: ${input.folder}. Is the drive or share mounted?`)
  } else {
    await mkdir(input.folder, { recursive: true })
  }
  await mkdir(input.workDir, { recursive: true })

  const tag = randomUUID().slice(0, 8)
  const snap = path.join(input.workDir, `snapshot-${tag}.db`)
  const file = await uniqueName(input.folder, archiveName("backup", now, mode))
  const finalPath = path.join(input.folder, file)
  // Protected backups are built and verified in plaintext on the data disk first: the server can't verify what it can't decrypt.
  const plainPath = mode === "none" ? finalPath : path.join(input.workDir, `${tag}.hcbackup`)
  let writer: ArchiveWriter | null = null

  try {
    await vacuumInto(input.dbPath, snap)
    const [migration, counts, refs] = await Promise.all([latestMigration(snap), modelCounts(snap), referencedFiles(snap)])
    const warnings = refs.skipped.map((r) => `Skipped unsafe file name: ${r}`)

    writer = await ArchiveWriter.create(plainPath)
    await writer.addFile(DB_ENTRY, snap, { compress: true })
    let done = 0
    for (const rel of refs.files) {
      const src = safeJoin(input.uploadDir, rel)
      if (src && (await isFile(src))) await writer.addFile(FILES_PREFIX + rel, src)
      else warnings.push(`Missing file: ${rel}`)
      input.onProgress?.(++done, refs.files.length)
    }
    const secrets = input.secrets
    const hasSecrets = mode !== "none" && !!secrets && !!(secrets.mailPassword || secrets.llmApiKey)
    if (hasSecrets) await writer.addBytes(SECRETS_ENTRY, JSON.stringify(secrets))
    if (input.readable) await input.readable(snap, writer)

    await writer.finish({
      formatVersion: FORMAT_VERSION, kind: "backup", scope: null, appVersion: input.appVersion, migration,
      createdAt: now.toISOString(), protection: mode, counts, warnings, hasReadable: !!input.readable, hasSecrets,
    })
    writer = null

    const v = await verifyArchive(plainPath, { workDir: input.workDir })
    if (!v.ok) throw new Error(`The new backup failed verification: ${v.error}`)

    if (mode !== "none") await protectInto(plainPath, finalPath, input.protection, file)

    const { size, sha256 } = await hashFile(finalPath)
    const sidecar: Sidecar = {
      sidecarVersion: SIDECAR_VERSION, file, createdAt: now.toISOString(), kind: "backup", size, sha256,
      appVersion: input.appVersion, migration, protection: mode,
      keyFingerprint: input.protection.mode === "key" ? input.protection.fingerprint : null, warningCount: warnings.length,
    }
    await writeSidecar(finalPath, sidecar)
    return { file, path: finalPath, sidecar, warnings }
  } catch (e) {
    await writer?.abort()
    await rm(finalPath + ".partial", { force: true })
    if (mode !== "none") await rm(finalPath, { force: true })
    throw e
  } finally {
    await rm(snap, { force: true })
    if (mode !== "none") await rm(plainPath, { force: true })
  }
}

/** Replaced in Task 10 with protect.ts. */
async function protectInto(_plain: string, _dest: string, _p: ProtectionConfig, _file: string): Promise<void> {
  throw new Error("Protected backups arrive in a later task.")
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/backup`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/backup/store.ts lib/backup/backup.ts lib/backup/store.test.ts lib/backup/backup.test.ts
git commit -m "Add backup engine with verify-after-write and folder retention"
```

---

### Task 5: Data model, jobs, alerts and scheduler

**Files:**
- Modify: `prisma/schema.prisma` (new enums + `BackupSettings`, `BackupRun`)
- Create: `prisma/migrations/20261011120000_backup/migration.sql`
- Create: `lib/backup/schedule.ts`, `lib/auth-guard.ts`, `lib/backup/settings-server.ts`, `lib/backup/alerts-server.ts`, `lib/backup/jobs-server.ts`, `lib/backup/scheduler-server.ts`
- Modify: `instrumentation.ts`, `lib/notification-links.ts`
- Test: `lib/backup/schedule.test.ts`

**Interfaces:**
- Consumes: `createBackup`, `pruneBackups`, `cleanupPartials`, `listBackups` (Task 4); path helpers (Task 1); `encrypt`/`decrypt` (`lib/secret-box.ts`); `notificationService` (`lib/notifications/channels.ts`)
- Produces:
  - schedule: `type ScheduleSettings = { schedule: "OFF" | "DAILY" | "WEEKLY"; time: string; weekday: number }`, `lastSlot(s, now): Date | null`, `nextSlot(s, now): Date | null`, `isDue(s, lastAttemptAt: Date | null, now): boolean`, `isStale(s, newestBackupAt: Date | null, enabledAt: Date, now): boolean`, `intervalMs(s): number`
  - auth-guard: `requireAdmin(): Promise<Session>` (redirects), `adminSession(): Promise<Session | null>` (for routes)
  - settings-server: `BACKUP_SETTINGS_ID = "singleton"`, `loadBackupSettings()`, `backupFolder(s): string`, `protectionConfig(s): ProtectionConfig`, `loadSecrets(): Promise<Secrets>`, `appVersion(): Promise<string>`
  - alerts-server: `BACKUP_ENTITY = "Backup"`, `raiseBackupAlert(cycleKey: string, title: string, message: string)`, `resolveBackupAlerts()`
  - jobs-server: `isJobRunning(): boolean`, `startBackupJob(trigger: "MANUAL" | "SCHEDULE", userId?: string): Promise<{ runId: string } | { error: string }>`, `runBackupJob(runId: string): Promise<void>`, `markInterruptedRuns(): Promise<number>`
  - scheduler-server: `startBackupScheduler()`

- [ ] **Step 1: Add models to `prisma/schema.prisma`** (append after `FeatureSettings`)

```prisma
// ─── Backup ──────────────────────────────────────────────────────────────────

enum BackupSchedule {
  OFF
  DAILY
  WEEKLY
}

enum BackupProtection {
  NONE
  KEY
  PASSWORD
}

enum BackupRunKind {
  BACKUP
  EXPORT
  RESTORE
}

enum BackupRunTrigger {
  MANUAL
  SCHEDULE
  CLI
}

enum BackupRunStatus {
  RUNNING
  OK
  WARN
  FAILED
  INTERRUPTED
}

/// Single row (id is always "singleton"). No row = defaults (schedule off, no protection).
model BackupSettings {
  id              String           @id @default("singleton")
  schedule        BackupSchedule   @default(OFF)
  /// "HH:mm", server local time (TZ).
  time            String           @default("03:00")
  /// 0 = Sunday … 6 = Saturday; WEEKLY only.
  weekday         Int              @default(0)
  /// null = <data dir>/backups.
  folder          String?
  keep            Int              @default(14)
  protection      BackupProtection @default(NONE)
  /// age X25519 recipient (age1…). The private key never reaches the server.
  publicKey       String?
  keyFingerprint  String?
  /// Password-zip passphrase, AES-256-GCM via lib/secret-box.ts.
  passphraseEnc   String?
  /// When the schedule was last turned on; staleness counts from here until the first backup.
  enabledAt       DateTime?
  hintDismissedAt DateTime?
  updatedAt       DateTime         @updatedAt
}

/// One backup, export or restore job: progress while running, history after.
model BackupRun {
  id            String           @id @default(cuid())
  kind          BackupRunKind
  trigger       BackupRunTrigger
  status        BackupRunStatus  @default(RUNNING)
  startedAt     DateTime         @default(now())
  finishedAt    DateTime?
  file          String?
  size          Int?
  protection    BackupProtection @default(NONE)
  progressDone  Int              @default(0)
  progressTotal Int              @default(0)
  /// JSON array of strings.
  warnings      String           @default("[]")
  error         String?
  createdById   String?

  @@index([kind, startedAt])
}
```

- [ ] **Step 2: Generate the migration without touching any database**

Run (Bash):
```bash
git show HEAD:prisma/schema.prisma > "$TEMP/old-schema.prisma"
mkdir -p prisma/migrations/20261011120000_backup
npx prisma migrate diff --from-schema "$TEMP/old-schema.prisma" --to-schema prisma/schema.prisma --script > prisma/migrations/20261011120000_backup/migration.sql
npx prisma generate
```
Expected: `migration.sql` with two `CREATE TABLE` statements (`BackupSettings`, `BackupRun`) and one index. If the flag names differ in this Prisma version, run `npx prisma migrate diff --help` and use its from/to schema-file flags. Do **not** run `prisma migrate dev` (it would touch `prisma/dev.db`).

- [ ] **Step 3: Write the failing test `lib/backup/schedule.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { isDue, isStale, lastSlot, nextSlot } from "./schedule"

const daily = { schedule: "DAILY" as const, time: "03:00", weekday: 0 }
const weekly = { schedule: "WEEKLY" as const, time: "03:00", weekday: 0 } // Sunday
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m) // Oct 2026, local; Oct 11 2026 is a Sunday

describe("backup schedule", () => {
  it("daily slot is today's time once passed, else yesterday's", () => {
    expect(lastSlot(daily, at(11, 4))).toEqual(at(11, 3))
    expect(lastSlot(daily, at(11, 2))).toEqual(at(10, 3))
    expect(nextSlot(daily, at(11, 4))).toEqual(at(12, 3))
  })
  it("weekly slot is the last matching weekday", () => {
    expect(lastSlot(weekly, at(14, 9))).toEqual(at(11, 3))
    expect(nextSlot(weekly, at(14, 9))).toEqual(at(18, 3))
  })
  it("off has no slots", () => {
    expect(lastSlot({ ...daily, schedule: "OFF" }, at(11, 4))).toBeNull()
    expect(isDue({ ...daily, schedule: "OFF" }, null, at(11, 4))).toBe(false)
  })
  it("is due once per slot, and catches up after downtime", () => {
    expect(isDue(daily, null, at(11, 4))).toBe(true)
    expect(isDue(daily, at(11, 3, 1), at(11, 4))).toBe(false)
    expect(isDue(daily, at(9, 3, 1), at(11, 10))).toBe(true) // container was down for a day
  })
  it("a failed attempt waits for the next slot rather than retrying every tick", () => {
    expect(isDue(daily, at(11, 3, 0), at(11, 3, 15))).toBe(false)
  })
  it("is stale after twice the interval without a backup", () => {
    expect(isStale(daily, at(9, 3), at(1, 0), at(11, 4))).toBe(true)
    expect(isStale(daily, at(10, 3), at(1, 0), at(11, 4))).toBe(false)
    expect(isStale(daily, null, at(11, 0), at(11, 4))).toBe(false) // just turned on
    expect(isStale(daily, null, at(8, 0), at(11, 4))).toBe(true)
    expect(isStale({ ...daily, schedule: "OFF" }, null, at(1, 0), at(11, 4))).toBe(false)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/backup/schedule.test.ts`
Expected: FAIL, cannot resolve `./schedule`.

- [ ] **Step 5: Implement `lib/backup/schedule.ts`**

```ts
// Engine file: pure. Server local time (TZ) throughout, like the digest hour.
export type ScheduleSettings = { schedule: "OFF" | "DAILY" | "WEEKLY"; time: string; weekday: number }

const DAY = 86_400_000

function hm(time: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  return m ? [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))] : [3, 0]
}

export function intervalMs(s: ScheduleSettings): number {
  return s.schedule === "WEEKLY" ? 7 * DAY : DAY
}

/** The most recent scheduled moment at or before now. */
export function lastSlot(s: ScheduleSettings, now: Date): Date | null {
  if (s.schedule === "OFF") return null
  const [h, m] = hm(s.time)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  if (s.schedule === "DAILY") {
    if (d > now) d.setDate(d.getDate() - 1)
    return d
  }
  let back = (d.getDay() - s.weekday + 7) % 7
  if (back === 0 && d > now) back = 7
  d.setDate(d.getDate() - back)
  return d
}

export function nextSlot(s: ScheduleSettings, now: Date): Date | null {
  const last = lastSlot(s, now)
  if (!last) return null
  const n = new Date(last)
  n.setDate(n.getDate() + (s.schedule === "WEEKLY" ? 7 : 1))
  return n
}

/** Due when nothing was attempted since the latest slot. A failure waits for the next slot. */
export function isDue(s: ScheduleSettings, lastAttemptAt: Date | null, now: Date): boolean {
  const slot = lastSlot(s, now)
  if (!slot) return false
  return !lastAttemptAt || lastAttemptAt < slot
}

/** Scheduled, and no backup within twice the interval (counted from when the schedule was turned on if none yet). */
export function isStale(s: ScheduleSettings, newestBackupAt: Date | null, enabledAt: Date, now: Date): boolean {
  if (s.schedule === "OFF") return false
  const since = newestBackupAt ?? enabledAt
  return now.getTime() - since.getTime() > 2 * intervalMs(s)
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/backup/schedule.test.ts`
Expected: PASS.

- [ ] **Step 7: Implement `lib/auth-guard.ts`**

```ts
import { auth } from "@/auth"
import { redirect } from "next/navigation"

/** For server actions and pages: sends anyone else away. */
export async function requireAdmin() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  return session
}

/** For route handlers, which answer with a status instead of redirecting. */
export async function adminSession() {
  const session = await auth()
  return session?.user.role === "ADMIN" ? session : null
}
```

- [ ] **Step 8: Implement `lib/backup/settings-server.ts`**

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/secret-box"
import { SETTINGS_ID } from "@/lib/notifications/mail-config"
import { defaultBackupFolder } from "./paths"
import type { ProtectionConfig, Secrets } from "./backup"
import type { BackupSettings } from "@/app/generated/prisma/client"

export const BACKUP_SETTINGS_ID = "singleton"

export async function loadBackupSettings(): Promise<BackupSettings> {
  return prisma.backupSettings.upsert({ where: { id: BACKUP_SETTINGS_ID }, create: { id: BACKUP_SETTINGS_ID }, update: {} })
}

export const backupFolder = (s: Pick<BackupSettings, "folder">) => s.folder || defaultBackupFolder()

/** Throws when protection is on but its key/passphrase is missing or unreadable, so a run fails loudly instead of writing an open backup. */
export function protectionConfig(s: BackupSettings): ProtectionConfig {
  if (s.protection === "KEY") {
    if (!s.publicKey || !s.keyFingerprint) throw new Error("Recovery key protection is on but no key is set.")
    return { mode: "key", recipient: s.publicKey, fingerprint: s.keyFingerprint }
  }
  if (s.protection === "PASSWORD") {
    const password = s.passphraseEnc ? decrypt(s.passphraseEnc) : null
    if (!password) throw new Error("Password protection is on but the saved password can't be read (was AUTH_SECRET changed?). Set it again.")
    return { mode: "password", password }
  }
  return { mode: "none" }
}

export async function loadSecrets(): Promise<Secrets> {
  const [mail, llm] = await Promise.all([
    prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID }, select: { passwordEnc: true } }),
    prisma.llmSettings.findUnique({ where: { id: "singleton" }, select: { apiKeyEnc: true } }),
  ])
  return {
    mailPassword: mail?.passwordEnc ? decrypt(mail.passwordEnc) : null,
    llmApiKey: llm?.apiKeyEnc ? decrypt(llm.apiKeyEnc) : null,
  }
}

let version: string | null = null
export async function appVersion(): Promise<string> {
  if (!version) {
    try {
      version = (JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "unknown"
    } catch {
      version = "unknown"
    }
  }
  return version
}
```

- [ ] **Step 9: Implement `lib/backup/alerts-server.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { notificationService } from "@/lib/notifications/channels"

/** Notification.relatedEntityType for backup problems; links to Settings → Data. CUSTOM type, like the Intake nudge, so no enum migration. */
export const BACKUP_ENTITY = "Backup"

/** One open alert per admin per cycleKey ("run:<id>" or "stale:<newest>"). Email follows through the digest. */
export async function raiseBackupAlert(cycleKey: string, title: string, message: string): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })
  for (const a of admins) {
    const exists = await prisma.notification.findFirst({ where: { userId: a.id, relatedEntityType: BACKUP_ENTITY, cycleKey } })
    if (exists) continue
    await notificationService.send({ userId: a.id, type: "CUSTOM", title, message, relatedEntityType: BACKUP_ENTITY, cycleKey })
  }
}

/** A good backup answers every open backup alert. */
export async function resolveBackupAlerts(): Promise<void> {
  await prisma.notification.updateMany({
    where: { relatedEntityType: BACKUP_ENTITY, dismissedAt: null },
    data: { isRead: true, dismissedAt: new Date() },
  })
}
```

- [ ] **Step 10: Implement `lib/backup/jobs-server.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { uploadDir, dbPathFromUrl, workDir } from "./paths"
import { createBackup } from "./backup"
import { cleanupPartials, pruneBackups } from "./store"
import { appVersion, backupFolder, loadBackupSettings, loadSecrets, protectionConfig } from "./settings-server"
import { raiseBackupAlert, resolveBackupAlerts } from "./alerts-server"

// One job at a time in this process (backup, export or restore staging share it).
let running: string | null = null
export const isJobRunning = () => running !== null

/** Claims the lock and records the run; the work continues after this returns. */
export async function startBackupJob(trigger: "MANUAL" | "SCHEDULE", userId?: string): Promise<{ runId: string } | { error: string }> {
  if (running) return { error: "A backup or export is already running." }
  const settings = await loadBackupSettings()
  const run = await prisma.backupRun.create({
    data: { kind: "BACKUP", trigger, protection: settings.protection, createdById: userId ?? null },
  })
  running = run.id
  void runBackupJob(run.id).finally(() => {
    running = null
  })
  return { runId: run.id }
}

export async function runBackupJob(runId: string): Promise<void> {
  const run = await prisma.backupRun.findUniqueOrThrow({ where: { id: runId } })
  let last = 0
  try {
    const settings = await loadBackupSettings()
    const folder = backupFolder(settings)
    const protection = protectionConfig(settings)
    const out = await createBackup({
      dbPath: dbPathFromUrl(process.env.DATABASE_URL),
      uploadDir: uploadDir(),
      folder,
      workDir: workDir(),
      appVersion: await appVersion(),
      protection,
      secrets: protection.mode === "none" ? null : await loadSecrets(),
      // The default folder may be created; a configured one (NAS share) must already exist.
      createFolder: !settings.folder,
      onProgress: (done, total) => {
        const now = Date.now()
        if (done === total || now - last > 1000) {
          last = now
          void prisma.backupRun.update({ where: { id: runId }, data: { progressDone: done, progressTotal: total } }).catch(() => {})
        }
      },
    })
    await pruneBackups(folder, settings.keep)
    await prisma.backupRun.update({
      where: { id: runId },
      data: {
        status: out.warnings.length ? "WARN" : "OK", finishedAt: new Date(), file: out.file, size: out.sidecar.size,
        warnings: JSON.stringify(out.warnings),
      },
    })
    await resolveBackupAlerts()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[backup] failed:", e)
    await prisma.backupRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), error: message } })
    await raiseBackupAlert(`run:${runId}`, "Backup failed", `${run.trigger === "SCHEDULE" ? "The scheduled backup" : "A backup"} didn't finish: ${message}`)
  }
}

/** At boot: a run still RUNNING was cut off by a restart. */
export async function markInterruptedRuns(): Promise<number> {
  const stuck = await prisma.backupRun.findMany({ where: { status: "RUNNING" }, select: { id: true, kind: true } })
  for (const r of stuck) {
    await prisma.backupRun.update({ where: { id: r.id }, data: { status: "INTERRUPTED", finishedAt: new Date(), error: "HomeCenter restarted while this was running." } })
    if (r.kind === "BACKUP") await raiseBackupAlert(`run:${r.id}`, "Backup interrupted", "HomeCenter restarted during a backup. The next scheduled backup will run as usual.")
  }
  const settings = await loadBackupSettings()
  await cleanupPartials(backupFolder(settings))
  return stuck.length
}
```

Add one test-free guard in `lib/backup/jobs-server.ts` is not needed; `markInterruptedRuns` is exercised in the Task 7 browser check (Review Focus 5) by inserting a RUNNING row into the scratch DB and restarting the scratch server.

- [ ] **Step 11: Implement `lib/backup/scheduler-server.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { isDue, isStale } from "./schedule"
import { listBackups } from "./store"
import { backupFolder, loadBackupSettings } from "./settings-server"
import { isJobRunning, markInterruptedRuns, startBackupJob } from "./jobs-server"
import { raiseBackupAlert } from "./alerts-server"

const TICK_MS = 15 * 60_000
const BOOT_DELAY_MS = 20_000

async function tick(now = new Date()) {
  const s = await loadBackupSettings()
  if (s.schedule === "OFF") return
  const last = await prisma.backupRun.findFirst({ where: { kind: "BACKUP", trigger: "SCHEDULE" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } })
  if (!isJobRunning() && isDue(s, last?.startedAt ?? null, now)) await startBackupJob("SCHEDULE")

  // Staleness reads the folder, so CLI backups count too.
  const newest = (await listBackups(backupFolder(s))).find((b) => b.kind === "backup")
  const newestAt = newest ? new Date(newest.createdAt) : null
  if (isStale(s, newestAt, s.enabledAt ?? s.updatedAt, now)) {
    await raiseBackupAlert(
      `stale:${newest?.createdAt ?? "none"}`,
      "Backups are behind",
      newestAt ? `The last backup is from ${newestAt.toLocaleDateString()}. Check Settings → Data.` : "No backup has been made yet. Check Settings → Data.",
    )
  }
}

let started = false
export function startBackupScheduler() {
  if (started) return
  started = true
  const run = () => void tick().catch((e) => console.error("[backup] scheduler tick failed:", e))
  setTimeout(() => {
    void markInterruptedRuns().catch((e) => console.error("[backup] interrupted-run check failed:", e)).finally(run)
  }, BOOT_DELAY_MS).unref()
  setInterval(run, TICK_MS).unref()
  console.log("[backup] scheduler started — checks every 15 minutes")
}
```

- [ ] **Step 12: Wire into `instrumentation.ts` and notification links**

In `instrumentation.ts`, after `startDocumentIndexer()`:
```ts
  const { startBackupScheduler } = await import("@/lib/backup/scheduler-server")
  startBackupScheduler()
```
In `lib/notification-links.ts`, import `BACKUP_ENTITY` from `@/lib/backup/alerts-server` and, next to the Intake branch:
```ts
    if (type === BACKUP_ENTITY) {
      links.set(n.id, "/settings?tab=data")
      continue
    }
```
(`alerts-server` imports Prisma, which `notification-links` already does.)

- [ ] **Step 13: Typecheck, test, commit**

Run: `npx tsc --noEmit; npm test`
Expected: clean; all tests pass.
```bash
git add prisma/schema.prisma prisma/migrations/20261011120000_backup lib/backup/schedule.ts lib/backup/schedule.test.ts lib/auth-guard.ts lib/backup/settings-server.ts lib/backup/alerts-server.ts lib/backup/jobs-server.ts lib/backup/scheduler-server.ts instrumentation.ts lib/notification-links.ts
git commit -m "Add backup settings, run history, scheduler and alerts"
```

---

### Task 6: Settings → Data tab (status, back up now, schedule, list)

**Files:**
- Modify: `lib/settings-sections.ts`, `app/(app)/settings/page.tsx`, `proxy.ts` (only in Task 13)
- Create: `lib/backup/overview-server.ts`, `lib/actions/backup.ts`, `app/api/backup/download/route.ts`
- Create: `components/settings/data/data-settings.tsx`, `components/settings/data/backup-status.tsx`, `components/settings/data/backup-schedule.tsx`, `components/settings/data/backup-list.tsx`, `components/settings/data/format.ts`
- Test: `lib/backup/overview.test.ts` (pure `statusTone`)

**Interfaces:**
- Consumes: Task 5 server modules; `listBackups`, `folderStatus`, `deleteBackup` (Task 4); `verifyArchive` (Task 3); `nextSlot`, `isStale` (Task 5)
- Produces:
  - `type BackupOverview = { settings: { schedule; time; weekday; folder: string; folderIsDefault: boolean; keep: number; protection: "NONE" | "KEY" | "PASSWORD"; keyFingerprint: string | null; hasPassword: boolean; hintDismissed: boolean }; folderStatus: FolderStatus; backups: BackupRow[]; running: { id: string; kind: string; done: number; total: number } | null; lastRun: { status: string; finishedAt: string | null; error: string | null; warnings: string[] } | null; nextRunAt: string | null; tone: "ok" | "stale" | "failed" | "none"; healthEnabled: boolean; restore: RestoreState }` with `type BackupRow = { file: string; createdAt: string; size: number; protection: "none" | "key" | "password"; keyFingerprint: string | null; warningCount: number; kind: "backup" | "export" }`. `RestoreState` is `null` until Task 13.
  - `loadBackupOverview(): Promise<BackupOverview>`, `statusTone(input: { schedule; newestAt: Date | null; lastStatus: string | null; stale: boolean }): "ok" | "stale" | "failed" | "none"`
  - Actions: `backUpNow(): Promise<{ runId: string } | { error: string }>`, `getBackupOverview(): Promise<BackupOverview>`, `saveBackupSchedule(input: { schedule; time; weekday; folder: string; keep: string }): Promise<{ ok: true; warning?: string } | { error: string }>`, `verifyBackup(file: string): Promise<{ ok: true; message: string } | { error: string }>`, `removeBackup(file: string): Promise<{ ok: true } | { error: string }>`, `dismissBackupHint(): Promise<void>`

- [ ] **Step 1: Write the failing test `lib/backup/overview.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { statusTone } from "./overview"

describe("statusTone", () => {
  it("none before any backup with no schedule", () => expect(statusTone({ newestAt: null, lastStatus: null, stale: false })).toBe("none"))
  it("failed when the last run failed", () => expect(statusTone({ newestAt: new Date(), lastStatus: "FAILED", stale: false })).toBe("failed"))
  it("failed when interrupted", () => expect(statusTone({ newestAt: new Date(), lastStatus: "INTERRUPTED", stale: false })).toBe("failed"))
  it("stale on warnings or staleness", () => {
    expect(statusTone({ newestAt: new Date(), lastStatus: "WARN", stale: false })).toBe("stale")
    expect(statusTone({ newestAt: new Date(), lastStatus: "OK", stale: true })).toBe("stale")
  })
  it("ok otherwise", () => expect(statusTone({ newestAt: new Date(), lastStatus: "OK", stale: false })).toBe("ok"))
})
```

- [ ] **Step 2: Run to verify it fails, then implement `lib/backup/overview.ts`** (pure, engine rules)

Run: `npx vitest run lib/backup/overview.test.ts` → FAIL (no module).
```ts
// Engine file: pure.
export type Tone = "ok" | "stale" | "failed" | "none"

export function statusTone(i: { newestAt: Date | null; lastStatus: string | null; stale: boolean }): Tone {
  if (i.lastStatus === "FAILED" || i.lastStatus === "INTERRUPTED") return "failed"
  if (!i.newestAt) return i.stale ? "stale" : "none"
  if (i.stale || i.lastStatus === "WARN") return "stale"
  return "ok"
}
```
Run again → PASS.

- [ ] **Step 3: Implement `lib/backup/overview-server.ts`**

```ts
import { prisma } from "@/lib/prisma"
import { loadFeatures } from "@/lib/features-server"
import { dataDir } from "./paths"
import { folderStatus, listBackups, type FolderStatus } from "./store"
import { backupFolder, loadBackupSettings } from "./settings-server"
import { isStale, nextSlot } from "./schedule"
import { statusTone, type Tone } from "./overview"
import type { Protection } from "./format"

export type BackupRow = { file: string; createdAt: string; size: number; protection: Protection; keyFingerprint: string | null; warningCount: number; kind: "backup" | "export" }

export type RestoreState = null // widened in Task 13

export type BackupOverview = {
  settings: {
    schedule: "OFF" | "DAILY" | "WEEKLY"; time: string; weekday: number; folder: string; folderIsDefault: boolean; keep: number
    protection: "NONE" | "KEY" | "PASSWORD"; keyFingerprint: string | null; hasPassword: boolean; hintDismissed: boolean
  }
  folderStatus: FolderStatus
  backups: BackupRow[]
  running: { id: string; kind: string; done: number; total: number } | null
  lastRun: { status: string; finishedAt: string | null; error: string | null; warnings: string[] } | null
  nextRunAt: string | null
  tone: Tone
  healthEnabled: boolean
  restore: RestoreState
}

export async function loadBackupOverview(now = new Date()): Promise<BackupOverview> {
  const s = await loadBackupSettings()
  const folder = backupFolder(s)
  const [status, stored, running, last, features] = await Promise.all([
    folderStatus(folder, dataDir()),
    listBackups(folder),
    prisma.backupRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
    prisma.backupRun.findFirst({ where: { kind: "BACKUP", status: { not: "RUNNING" } }, orderBy: { startedAt: "desc" } }),
    loadFeatures(),
  ])
  const backups = stored.filter((b) => b.kind === "backup")
  const newestAt = backups[0] ? new Date(backups[0].createdAt) : null
  const stale = isStale(s, newestAt, s.enabledAt ?? s.updatedAt, now)
  return {
    settings: {
      schedule: s.schedule, time: s.time, weekday: s.weekday, folder, folderIsDefault: !s.folder, keep: s.keep,
      protection: s.protection, keyFingerprint: s.keyFingerprint, hasPassword: !!s.passphraseEnc, hintDismissed: !!s.hintDismissedAt,
    },
    folderStatus: status,
    backups: backups.map((b) => ({ file: b.file, createdAt: b.createdAt, size: b.size, protection: b.protection, keyFingerprint: b.keyFingerprint, warningCount: b.warningCount, kind: b.kind })),
    running: running ? { id: running.id, kind: running.kind, done: running.progressDone, total: running.progressTotal } : null,
    lastRun: last ? { status: last.status, finishedAt: last.finishedAt?.toISOString() ?? null, error: last.error, warnings: JSON.parse(last.warnings) as string[] } : null,
    nextRunAt: nextSlot(s, now)?.toISOString() ?? null,
    tone: statusTone({ newestAt, lastStatus: last?.status ?? null, stale }),
    healthEnabled: features.health,
    restore: null,
  }
}
```

- [ ] **Step 4: Implement `lib/actions/backup.ts`**

```ts
"use server"

import path from "node:path"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/auth-guard"
import { startBackupJob } from "@/lib/backup/jobs-server"
import { loadBackupOverview, type BackupOverview } from "@/lib/backup/overview-server"
import { BACKUP_SETTINGS_ID, backupFolder, loadBackupSettings } from "@/lib/backup/settings-server"
import { deleteBackup, folderStatus, listBackups } from "@/lib/backup/store"
import { hashFile } from "@/lib/backup/archive"
import { verifyArchive } from "@/lib/backup/verify"
import { dataDir, workDir } from "@/lib/backup/paths"

export async function getBackupOverview(): Promise<BackupOverview> {
  await requireAdmin()
  return loadBackupOverview()
}

export async function backUpNow() {
  const session = await requireAdmin()
  const r = await startBackupJob("MANUAL", session.user.id)
  revalidatePath("/settings")
  return r
}

const scheduleSchema = z.object({
  schedule: z.enum(["OFF", "DAILY", "WEEKLY"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must look like 03:00."),
  weekday: z.coerce.number().int().min(0).max(6),
  folder: z.string().trim(),
  keep: z.coerce.number().int().min(1, "Keep at least 1 backup.").max(365),
})

export async function saveBackupSchedule(input: z.input<typeof scheduleSchema>): Promise<{ ok: true; warning?: string } | { error: string }> {
  await requireAdmin()
  const parsed = scheduleSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  const v = parsed.data
  if (v.folder && !path.isAbsolute(v.folder)) return { error: "Use a full folder path, such as /backups." }
  const folder = v.folder || null
  const status = await folderStatus(folder ?? backupFolder({ folder: null }), dataDir())
  if (folder && !status.exists) return { error: "That folder doesn't exist inside the container. Mount it in docker-compose first." }
  if (folder && !status.writable) return { error: "HomeCenter can't write to that folder." }
  const before = await loadBackupSettings()
  await prisma.backupSettings.update({
    where: { id: BACKUP_SETTINGS_ID },
    data: {
      schedule: v.schedule, time: v.time, weekday: v.weekday, folder, keep: v.keep,
      enabledAt: v.schedule !== "OFF" && before.schedule === "OFF" ? new Date() : before.enabledAt,
    },
  })
  revalidatePath("/settings")
  return status.sameDevice ? { ok: true, warning: "This folder is on the same disk as your data. If that disk fails, you lose both." } : { ok: true }
}

export async function verifyBackup(file: string): Promise<{ ok: true; message: string } | { error: string }> {
  await requireAdmin()
  const b = (await listBackups(backupFolder(await loadBackupSettings()))).find((x) => x.file === file)
  if (!b) return { error: "That backup isn't in the backup folder any more." }
  const { sha256 } = await hashFile(b.path)
  if (sha256 !== b.sha256) return { error: "This file has changed or is damaged since it was written." }
  if (b.protection !== "none") return { ok: true, message: "File intact. Its contents can be checked during a restore, with the key or password." }
  const v = await verifyArchive(b.path, { workDir: workDir() })
  return v.ok ? { ok: true, message: "Backup checked: every file and the database are intact." } : { error: v.error }
}

export async function removeBackup(file: string): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  const ok = await deleteBackup(backupFolder(await loadBackupSettings()), file)
  revalidatePath("/settings")
  return ok ? { ok: true } : { error: "That backup isn't in the backup folder any more." }
}

export async function dismissBackupHint(): Promise<void> {
  await requireAdmin()
  await prisma.backupSettings.update({ where: { id: BACKUP_SETTINGS_ID }, data: { hintDismissedAt: new Date() } })
  revalidatePath("/settings")
}
```

- [ ] **Step 5: Implement `app/api/backup/download/route.ts`**

```ts
import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { adminSession } from "@/lib/auth-guard"
import { backupFolder, loadBackupSettings } from "@/lib/backup/settings-server"
import { listBackups } from "@/lib/backup/store"

export async function GET(request: NextRequest) {
  if (!(await adminSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const file = request.nextUrl.searchParams.get("file") ?? ""
  // Only names the folder listing knows; never a path from the client.
  const b = (await listBackups(backupFolder(await loadBackupSettings()))).find((x) => x.file === file)
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return new NextResponse(Readable.toWeb(createReadStream(b.path)) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(b.size),
      "Content-Disposition": `attachment; filename="${b.file}"`,
    },
  })
}
```

- [ ] **Step 6: Register the section**

`lib/settings-sections.ts`: import `DatabaseBackup` from lucide-react; add `"data"` to `SettingsSectionId`; append
```ts
  { id: "data", label: "Data & backups", description: "Backups, restore and export of everything in HomeCenter", icon: DatabaseBackup, adminOnly: true },
```
(If `DatabaseBackup` isn't exported by the installed lucide-react, use `HardDriveDownload`.)

`app/(app)/settings/page.tsx`: import `DataSettings` and `loadBackupOverview`; add to the `Promise.all` list a final entry `is("data") ? loadBackupOverview() : Promise.resolve(null)` destructured as `backup`; render
```tsx
          {is("data") && backup && <DataSettings initial={backup} />}
```

- [ ] **Step 7: Implement the UI components**

`components/settings/data/format.ts`:
```ts
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ["KB", "MB", "GB", "TB"]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export const PROTECTION_LABEL = { none: "No protection", key: "Recovery key", password: "Password zip" } as const
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
```

`components/settings/data/data-settings.tsx`:
```tsx
"use client"

import { useCallback, useEffect, useState } from "react"
import { getBackupOverview } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { BackupStatus } from "./backup-status"
import { BackupSchedule } from "./backup-schedule"
import { BackupList } from "./backup-list"

/** Settings → Data. Holds the overview and polls it while a job runs. */
export function DataSettings({ initial }: { initial: BackupOverview }) {
  const [data, setData] = useState(initial)
  const refresh = useCallback(async () => setData(await getBackupOverview()), [])

  useEffect(() => {
    if (!data.running) return
    const t = setInterval(() => void refresh(), 1000)
    return () => clearInterval(t)
  }, [data.running, refresh])

  return (
    <div className="space-y-6">
      <BackupStatus data={data} onStarted={refresh} />
      <BackupSchedule data={data} onSaved={refresh} />
      <BackupList data={data} onChanged={refresh} />
    </div>
  )
}
```

`components/settings/data/backup-status.tsx`:
```tsx
"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { backUpNow, dismissBackupHint } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { formatBytes, formatWhen, PROTECTION_LABEL } from "./format"

const TONE = {
  ok: { icon: CheckCircle2, text: "Backups are up to date", cls: "text-emerald-600 dark:text-emerald-400" },
  stale: { icon: AlertTriangle, text: "Backups need attention", cls: "text-amber-600 dark:text-amber-400" },
  failed: { icon: XCircle, text: "The last backup failed", cls: "text-destructive" },
  none: { icon: Info, text: "No backups yet", cls: "text-muted-foreground" },
} as const

export function BackupStatus({ data, onStarted }: { data: BackupOverview; onStarted: () => Promise<void> }) {
  const [pending, start] = useTransition()
  const tone = TONE[data.tone]
  const newest = data.backups[0]
  const run = data.running

  function now() {
    start(async () => {
      const r = await backUpNow()
      if ("error" in r) toast.error(r.error)
      else toast.success("Backup started. You can leave this page.")
      await onStarted()
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className={cn("flex items-center gap-2", tone.cls)}>
          <tone.icon className="h-5 w-5" aria-hidden="true" />
          {tone.text}
        </CardTitle>
        <CardDescription>
          {newest
            ? `Last backup ${formatWhen(newest.createdAt)} · ${formatBytes(newest.size)} · ${PROTECTION_LABEL[newest.protection]}`
            : "Make your first backup now, or turn on a schedule below."}
          {data.nextRunAt && data.settings.schedule !== "OFF" ? ` · Next ${formatWhen(data.nextRunAt)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        {data.lastRun?.status === "FAILED" || data.lastRun?.status === "INTERRUPTED" ? (
          <p className="text-sm text-destructive">{data.lastRun.error}</p>
        ) : null}
        {data.lastRun?.status === "WARN" && (
          <details className="text-sm text-amber-700 dark:text-amber-400">
            <summary>{data.lastRun.warnings.length} file(s) were missing from the last backup</summary>
            <ul className="mt-1 list-disc pl-5 text-xs">{data.lastRun.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
        {data.settings.protection === "NONE" && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Backups are readable by anyone who gets the file.{" "}
            {data.healthEnabled ? "They include health records and documents." : "They include your records and documents."}{" "}
            You can protect them under Protection.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={now} disabled={pending || !!run}>
            {run ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {run ? (run.total ? `Backing up… ${run.done} of ${run.total} files` : "Backing up…") : "Back up now"}
          </Button>
          <span className="text-xs text-muted-foreground">Saved to {data.settings.folder}</span>
        </div>
        {!newest && !data.settings.hintDismissed && data.settings.schedule === "OFF" && (
          <p className="text-xs text-muted-foreground">
            Tip: a daily backup to a different disk (a NAS share or USB drive) protects against a failed drive.{" "}
            <button type="button" className="underline" onClick={() => void dismissBackupHint().then(onStarted)}>Dismiss</button>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

`components/settings/data/backup-schedule.tsx`:
```tsx
"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveBackupSchedule } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { WEEKDAYS } from "./format"

export function BackupSchedule({ data, onSaved }: { data: BackupOverview; onSaved: () => Promise<void> }) {
  const s = data.settings
  const [schedule, setSchedule] = useState(s.schedule)
  const [time, setTime] = useState(s.time)
  const [weekday, setWeekday] = useState(String(s.weekday))
  const [folder, setFolder] = useState(s.folderIsDefault ? "" : s.folder)
  const [keep, setKeep] = useState(String(s.keep))
  const [pending, start] = useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await saveBackupSchedule({ schedule, time, weekday, folder, keep })
      if ("error" in r) return void toast.error(r.error)
      toast.success("Backup schedule saved.")
      if (r.warning) toast.warning(r.warning)
      await onSaved()
    })
  }

  const select = "h-9 rounded-md border bg-background px-2 text-sm"
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Schedule</CardTitle>
        <CardDescription>Backups run in the background at this time, server time. Older ones are removed after the newest {s.keep}.</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bk-schedule">How often</Label>
            <select id="bk-schedule" className={select} value={schedule} onChange={(e) => setSchedule(e.target.value as typeof schedule)}>
              <option value="OFF">Off</option>
              <option value="DAILY">Every day</option>
              <option value="WEEKLY">Every week</option>
            </select>
          </div>
          <div className="flex gap-3">
            {schedule === "WEEKLY" && (
              <div className="space-y-1.5">
                <Label htmlFor="bk-day">Day</Label>
                <select id="bk-day" className={select} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bk-time">Time</Label>
              <Input id="bk-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={schedule === "OFF"} />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bk-folder">Folder</Label>
            <Input id="bk-folder" placeholder={`${s.folderIsDefault ? s.folder : "/data/backups"} (default)`} value={folder} onChange={(e) => setFolder(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              A path inside the container. For a real backup, mount a different disk or NAS share (for example <code>/backups</code>) in docker-compose.
              {data.folderStatus.sameDevice && data.folderStatus.exists ? " The current folder is on the same disk as your data." : ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-keep">Keep the newest</Label>
            <Input id="bk-keep" type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(e.target.value)} />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save schedule"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
```

`components/settings/data/backup-list.tsx`:
```tsx
"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Download, ShieldCheck, Trash2, KeyRound, Lock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { removeBackup, verifyBackup } from "@/lib/actions/backup"
import type { BackupOverview, BackupRow } from "@/lib/backup/overview-server"
import { formatBytes, formatWhen, PROTECTION_LABEL } from "./format"

export function BackupList({ data, onChanged, onRestore }: { data: BackupOverview; onChanged: () => Promise<void>; onRestore?: (b: BackupRow) => void }) {
  const [pending, start] = useTransition()
  const act = (fn: () => Promise<void>) => start(fn)

  if (data.backups.length === 0) return null
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Backups</CardTitle>
        <CardDescription>In {data.settings.folder}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <ul className="divide-y">
          {data.backups.map((b) => (
            <li key={b.file} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{formatWhen(b.createdAt)}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {formatBytes(b.size)}
                  <span className="inline-flex items-center gap-1">
                    {b.protection === "key" ? <KeyRound className="h-3 w-3" aria-hidden="true" /> : b.protection === "password" ? <Lock className="h-3 w-3" aria-hidden="true" /> : null}
                    {PROTECTION_LABEL[b.protection]}
                    {b.keyFingerprint ? ` ${b.keyFingerprint}` : ""}
                  </span>
                  {b.warningCount > 0 && <span className="text-amber-600 dark:text-amber-400">{b.warningCount} missing file(s)</span>}
                </p>
              </div>
              <div className="flex gap-1">
                <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/api/backup/download?file=${encodeURIComponent(b.file)}`} aria-label={`Download ${b.file}`}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                </a>
                <Button variant="ghost" size="sm" disabled={pending} aria-label="Check this backup"
                  onClick={() => act(async () => { const r = await verifyBackup(b.file); if ("error" in r) toast.error(r.error); else toast.success(r.message) })}>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                </Button>
                {onRestore && <Button variant="outline" size="sm" onClick={() => onRestore(b)}>Restore</Button>}
                <Button variant="ghost" size="sm" disabled={pending} aria-label="Delete this backup"
                  onClick={() => act(async () => {
                    if (!window.confirm(`Delete the backup from ${formatWhen(b.createdAt)}? This can't be undone.`)) return
                    const r = await removeBackup(b.file)
                    if ("error" in r) toast.error(r.error)
                    await onChanged()
                  })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
```
Link-styled buttons in this repo use `className={buttonVariants(...)}` on the `<a>`/`<Link>` (see `components/settings/llm-settings.tsx:329`).

- [ ] **Step 8: Typecheck, lint, tests**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: clean, no new lint problems, all pass.

- [ ] **Step 9: Browser check on a scratch server (port 3133)**

Build and start against a scratch copy (pattern from earlier sessions; scratch dir under the session scratchpad):
```bash
npx next build
# env: DATABASE_URL=file:<scratch>/dev.db UPLOAD_DIR=<scratch>/uploads SEARCH_INDEX_PATH=<scratch>/search-index.db
#      AUTH_URL/NEXTAUTH_URL/APP_URL=http://localhost:3133 MAIL_DRY_RUN=1
npx next start -p 3133
```
Apply the new migration to the scratch DB only: `DATABASE_URL=file:<scratch>/dev.db npx prisma migrate deploy`.
With Playwright (desktop 1366×900 and phone 390×844, light and dark):
1. Settings → Data shows "No backups yet" and the no-protection notice.
2. Back up now → button shows progress → status turns green; list shows one backup; Download returns a file whose size matches; Check shows "Backup checked…".
3. Schedule Daily 03:00, folder `/nonexistent` → error toast "doesn't exist inside the container"; blank folder → saved, same-disk warning toast.
4. Review Focus 5: insert `INSERT INTO BackupRun (id, kind, trigger, status, startedAt) VALUES ('stuck','BACKUP','MANUAL','RUNNING', CURRENT_TIMESTAMP)` into the scratch DB, restart the scratch server, wait 25 s: Data tab shows "The last backup failed" with "HomeCenter restarted…", and the bell has "Backup interrupted" linking to `/settings?tab=data`.
5. No horizontal scroll at 390 px.
Stop the scratch server afterwards.

- [ ] **Step 10: Commit**

```bash
git add lib/settings-sections.ts "app/(app)/settings/page.tsx" lib/backup/overview.ts lib/backup/overview.test.ts lib/backup/overview-server.ts lib/actions/backup.ts app/api/backup/download components/settings/data
git commit -m "Add Settings > Data with Back up now, schedule and backup list"
```

---

### Task 7: CLI backup/verify, Docker wiring, docs

**Files:**
- Create: `lib/backup/raw-settings.ts`, `scripts/backup.ts`, `scripts/backup-verify.ts`
- Modify: `package.json` (scripts), `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`, `README.md`
- Test: `lib/backup/raw-settings.test.ts`

**Interfaces:**
- Consumes: `createBackup`, `pruneBackups`, `verifyArchive`, `openDb`, `decrypt` (`../secret-box`)
- Produces: `readRawSettings(dbPath): Promise<RawSettings>` where `type RawSettings = { folder: string | null; keep: number; protection: "NONE" | "KEY" | "PASSWORD"; publicKey: string | null; keyFingerprint: string | null; passphraseEnc: string | null }`; `readRawSecrets(dbPath): Promise<Secrets>`; `rawProtection(s: RawSettings): ProtectionConfig`

- [ ] **Step 1: Write the failing test `lib/backup/raw-settings.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { createMigratedDb, tempDir } from "./test-support"
import { openDb } from "./snapshot"
import { rawProtection, readRawSettings } from "./raw-settings"

describe("raw settings", () => {
  it("defaults when no row exists", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    expect(await readRawSettings(db)).toMatchObject({ folder: null, keep: 14, protection: "NONE" })
  })
  it("reads a saved row", async () => {
    const dir = await tempDir()
    const db = path.join(dir, "x.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute(`INSERT INTO "BackupSettings" (id, folder, keep, protection, publicKey, keyFingerprint, updatedAt) VALUES ('singleton', '/backups', 5, 'KEY', 'age1abc', 'ab12', CURRENT_TIMESTAMP)`)
    c.close()
    const s = await readRawSettings(db)
    expect(s).toMatchObject({ folder: "/backups", keep: 5, protection: "KEY" })
    expect(rawProtection(s)).toEqual({ mode: "key", recipient: "age1abc", fingerprint: "ab12" })
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement `lib/backup/raw-settings.ts`, run to pass**

Run: `npx vitest run lib/backup/raw-settings.test.ts` → FAIL.
```ts
// Engine file: relative imports and npm packages only. The CLI reads settings
// straight from the DB file so it works with the app stopped.
import { decrypt } from "../secret-box"
import { openDb } from "./snapshot"
import type { ProtectionConfig, Secrets } from "./backup"

export type RawSettings = {
  folder: string | null; keep: number; protection: "NONE" | "KEY" | "PASSWORD"
  publicKey: string | null; keyFingerprint: string | null; passphraseEnc: string | null
}

const DEFAULTS: RawSettings = { folder: null, keep: 14, protection: "NONE", publicKey: null, keyFingerprint: null, passphraseEnc: null }

export async function readRawSettings(dbPath: string): Promise<RawSettings> {
  const c = openDb(dbPath)
  try {
    const r = await c.execute(`SELECT folder, keep, protection, publicKey, keyFingerprint, passphraseEnc FROM "BackupSettings" WHERE id = 'singleton'`)
    const row = r.rows[0]
    if (!row) return DEFAULTS
    return {
      folder: (row.folder as string | null) || null, keep: Number(row.keep), protection: row.protection as RawSettings["protection"],
      publicKey: row.publicKey as string | null, keyFingerprint: row.keyFingerprint as string | null, passphraseEnc: row.passphraseEnc as string | null,
    }
  } catch {
    return DEFAULTS // older schema without the table
  } finally {
    c.close()
  }
}

export function rawProtection(s: RawSettings): ProtectionConfig {
  if (s.protection === "KEY" && s.publicKey && s.keyFingerprint) return { mode: "key", recipient: s.publicKey, fingerprint: s.keyFingerprint }
  if (s.protection === "PASSWORD") {
    const password = s.passphraseEnc ? decrypt(s.passphraseEnc) : null
    if (!password) throw new Error("Password protection is on but the saved password can't be read with this AUTH_SECRET.")
    return { mode: "password", password }
  }
  if (s.protection === "KEY") throw new Error("Recovery key protection is on but no key is set.")
  return { mode: "none" }
}

export async function readRawSecrets(dbPath: string): Promise<Secrets> {
  const c = openDb(dbPath)
  try {
    const mail = await c.execute(`SELECT passwordEnc FROM "MailSettings" WHERE id = 'singleton'`).catch(() => ({ rows: [] }))
    const llm = await c.execute(`SELECT apiKeyEnc FROM "LlmSettings" WHERE id = 'singleton'`).catch(() => ({ rows: [] }))
    const m = mail.rows[0]?.passwordEnc as string | undefined
    const k = llm.rows[0]?.apiKeyEnc as string | undefined
    return { mailPassword: m ? decrypt(m) : null, llmApiKey: k ? decrypt(k) : null }
  } finally {
    c.close()
  }
}
```
Run again → PASS.

- [ ] **Step 3: Write `scripts/backup.ts`**

```ts
// npm run backup [-- --folder /path]
// Same engine and settings as Settings → Data; works with the app running or stopped.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createBackup } from "../lib/backup/backup"
import { dbPathFromUrl, defaultBackupFolder, uploadDir, workDir } from "../lib/backup/paths"
import { rawProtection, readRawSecrets, readRawSettings } from "../lib/backup/raw-settings"
import { pruneBackups } from "../lib/backup/store"

async function main() {
  const args = process.argv.slice(2)
  const i = args.indexOf("--folder")
  const dbPath = dbPathFromUrl(process.env.DATABASE_URL)
  const s = await readRawSettings(dbPath)
  const folder = i >= 0 ? path.resolve(args[i + 1]) : s.folder || defaultBackupFolder()
  const protection = rawProtection(s)
  const version = (JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string }).version ?? "unknown"
  const out = await createBackup({
    dbPath, uploadDir: uploadDir(), folder, workDir: workDir(), appVersion: version, protection,
    secrets: protection.mode === "none" ? null : await readRawSecrets(dbPath),
    createFolder: i < 0 && !s.folder,
    onProgress: (d, t) => process.stdout.write(`\rFiles ${d}/${t}`),
  })
  process.stdout.write("\n")
  const pruned = await pruneBackups(folder, s.keep)
  console.log(`Backup written: ${out.path}`)
  for (const w of out.warnings) console.warn(`Warning: ${w}`)
  if (pruned.length) console.log(`Removed ${pruned.length} older backup(s).`)
}

main().catch((e) => {
  console.error(`Backup failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
```

- [ ] **Step 4: Write `scripts/backup-verify.ts`**

```ts
// npm run backup:verify -- <file>   (protected files are checked during restore: add --key/--passphrase-env in Task 12)
import path from "node:path"
import { verifyArchive } from "../lib/backup/verify"
import { workDir } from "../lib/backup/paths"

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error("Usage: npm run backup:verify -- <file>")
  const r = await verifyArchive(path.resolve(file), { workDir: workDir() })
  if (!r.ok) throw new Error(r.error)
  console.log(`OK: ${r.manifest.files.length} entries, made ${r.manifest.createdAt} by HomeCenter ${r.manifest.appVersion}.`)
}

main().catch((e) => {
  console.error(`Not OK: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
```

- [ ] **Step 5: Package scripts, Docker, compose, README**

`package.json` scripts, add:
```json
    "backup": "tsx scripts/backup.ts",
    "backup:verify": "tsx scripts/backup-verify.ts",
```
`Dockerfile` runner stage, after `COPY --from=builder /app/package.json ./package.json`:
```dockerfile
# Backup/restore engine for the boot-time restore step and the CLI (run with tsx).
COPY --from=builder /app/lib/backup ./lib/backup
COPY --from=builder /app/lib/attachment-location.ts ./lib/attachment-location.ts
COPY --from=builder /app/lib/secret-box.ts ./lib/secret-box.ts
COPY --from=builder /app/scripts ./scripts
```
and next to `ENV UPLOAD_DIR=/data/uploads`:
```dockerfile
# Lets "Restart to finish" exit the process; compose's restart policy brings it back.
ENV HOMECENTER_SUPERVISED=1
```
`docker-entrypoint.sh`: change `mkdir -p /data/uploads /data/models` to `mkdir -p /data/uploads /data/models /data/backups`.
`docker-compose.yml` under `volumes:`:
```yaml
      # Optional: a second disk or NAS share for backups (Settings → Data → Folder: /backups).
      # - /volume2/backups/homecenter:/backups
```
`README.md`: replace the "How do I back it up?" answer with:
```markdown
### How do I back it up?

Settings → Data. **Back up now** makes a verified backup; a daily or weekly **schedule** keeps the newest 14 (configurable). Point the folder at a different disk or NAS share (mount it in `docker-compose.yml`, e.g. `/backups`), because a backup on the same disk as your data doesn't survive that disk failing.

Each backup is one file holding the database and every uploaded file. Protection is optional: none, a **recovery key** (the server can't open its own backups), or a **password zip** (opens in 7-Zip, WinRAR or Keka). From the command line: `npm run backup` and `npm run backup:verify -- <file>`.

Keep your `AUTH_SECRET`: an unprotected backup restored under a different one asks you to re-enter the mail password and AI key. Protected backups carry them.
```

- [ ] **Step 6: Run the CLI against a scratch copy only**

Run (Bash, scratch paths): `DATABASE_URL=file:<scratch>/dev.db UPLOAD_DIR=<scratch>/uploads npm run backup -- --folder <scratch>/cli-backups` then `npm run backup:verify -- <scratch>/cli-backups/<file>`.
Expected: "Backup written: …" then "OK: N entries…".

- [ ] **Step 7: Full checks and commit**

Run: `npm test; npx tsc --noEmit; npm run lint`
```bash
git add lib/backup/raw-settings.ts lib/backup/raw-settings.test.ts scripts/backup.ts scripts/backup-verify.ts package.json Dockerfile docker-entrypoint.sh docker-compose.yml README.md
git commit -m "Add backup CLI, Docker wiring and README backup guide"
```

---

# Slice 2 — Protection

### Task 8: Protection engine (recovery key, password zip)

**Files:**
- Create: `lib/backup/protect.ts`
- Test: `lib/backup/protect.test.ts`

**Interfaces:**
- Consumes: `ArchiveWriter`, `ArchiveReader` (Task 2); `ProtectionConfig` (Task 4); `innerName`, `MIN_PASSWORD`, `Protection` (Task 1)
- Produces:
  - `protectFile(plainPath: string, destPath: string, cfg: ProtectionConfig, destName: string): Promise<void>` (writes `destPath` directly, no partial left on failure)
  - `type UnlockSecret = { key?: string; password?: string }`
  - `detectProtection(p: string): Promise<Protection | "unknown">`
  - `unprotectFile(src: string, destPlain: string, secret: UnlockSecret): Promise<{ ok: true } | { ok: false; error: string; needs?: "key" | "password" }>`
  - `fingerprintOf(recipient: string): Promise<string>` (format `xxxx-xxxx-xxxx-xxxx`, isomorphic via `globalThis.crypto.subtle`)
  - `parseIdentity(text: string): string | null` (finds `AGE-SECRET-KEY-1…` in a kit or pasted text)
  - `passwordProblem(pw: string): string | null`

- [ ] **Step 1: Write the failing test `lib/backup/protect.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { readFile, writeFile } from "node:fs/promises"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { ArchiveReader } from "./archive"
import { detectProtection, fingerprintOf, parseIdentity, passwordProblem, protectFile, unprotectFile } from "./protect"
import { tempDir } from "./test-support"

async function plain(dir: string) {
  const p = path.join(dir, "plain.hcbackup")
  await writeFile(p, "PK-pretend-archive-bytes")
  return p
}

describe("recovery key", () => {
  it("round-trips and is detected", async () => {
    const dir = await tempDir()
    const id = await generateX25519Identity()
    const recipient = await identityToRecipient(id)
    const dest = path.join(dir, "b.hcbackup.age")
    await protectFile(await plain(dir), dest, { mode: "key", recipient, fingerprint: await fingerprintOf(recipient) }, "b.hcbackup.age")
    expect(await detectProtection(dest)).toBe("key")
    expect(await unprotectFile(dest, path.join(dir, "o1"), {})).toMatchObject({ ok: false, needs: "key" })
    const other = await generateX25519Identity()
    expect(await unprotectFile(dest, path.join(dir, "o2"), { key: other })).toMatchObject({ ok: false, error: expect.stringContaining("doesn't open") })
    expect(await unprotectFile(dest, path.join(dir, "o3"), { key: `# kit\n${id}\n` })).toEqual({ ok: true })
    expect(await readFile(path.join(dir, "o3"), "utf8")).toBe("PK-pretend-archive-bytes")
  })
})

describe("password zip", () => {
  it("double-wraps so inner names are hidden, and round-trips", async () => {
    const dir = await tempDir()
    const dest = path.join(dir, "homecenter-2026-10-11-0300.hcbackup.zip")
    await protectFile(await plain(dir), dest, { mode: "password", password: "abcdef" }, "homecenter-2026-10-11-0300.hcbackup.zip")
    expect(await detectProtection(dest)).toBe("password")
    const outer = await ArchiveReader.open(dest)
    expect(outer.entries()).toEqual(["homecenter-2026-10-11-0300.hcbackup"]) // the only visible name
    await outer.close()
    expect(await unprotectFile(dest, path.join(dir, "o"), { password: "wrong1" })).toMatchObject({ ok: false, error: expect.stringContaining("doesn't open") })
    expect(await unprotectFile(dest, path.join(dir, "o"), { password: "abcdef" })).toEqual({ ok: true })
    expect(await readFile(path.join(dir, "o"), "utf8")).toBe("PK-pretend-archive-bytes")
  })
})

describe("helpers", () => {
  it("detects a plain HomeCenter archive and junk", async () => {
    const dir = await tempDir()
    const { ArchiveWriter } = await import("./archive")
    const p = path.join(dir, "p.hcbackup")
    const w = await ArchiveWriter.create(p)
    await w.finish({ formatVersion: 1, kind: "backup", scope: null, appVersion: "t", migration: "m", createdAt: "", protection: "none", counts: {}, warnings: [], hasReadable: false, hasSecrets: false })
    expect(await detectProtection(p)).toBe("none")
    await writeFile(path.join(dir, "j"), "junk")
    expect(await detectProtection(path.join(dir, "j"))).toBe("unknown")
  })
  it("fingerprints are stable and short", async () => {
    expect(await fingerprintOf("age1abc")).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/)
    expect(await fingerprintOf("age1abc")).toBe(await fingerprintOf("age1abc"))
  })
  it("finds the key in a recovery kit", () => {
    expect(parseIdentity("HomeCenter recovery key\nAGE-SECRET-KEY-1QQQ\nmore")).toBe("AGE-SECRET-KEY-1QQQ")
    expect(parseIdentity("nothing here")).toBeNull()
  })
  it("password rule is 6 characters, nothing else", () => {
    expect(passwordProblem("12345")).toBe("Use at least 6 characters.")
    expect(passwordProblem("aaaaaa")).toBeNull()
    expect(passwordProblem("      ")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/backup/protect.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `lib/backup/protect.ts`**

```ts
// Engine file: relative imports and npm packages only.
// Recovery key = age X25519 (the server only ever holds the public half).
// Password = an AES-256 zip holding one inner archive, so file names stay hidden.
import { createReadStream, createWriteStream } from "node:fs"
import { open, rm } from "node:fs/promises"
import { Readable, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { Decrypter, Encrypter } from "age-encryption"
import { ArchiveReader, ArchiveWriter } from "./archive"
import { innerName, MANIFEST_ENTRY, MIN_PASSWORD, type Protection } from "./format"
import type { ProtectionConfig } from "./backup"

const AGE_MAGIC = "age-encryption.org/v1"

export type UnlockSecret = { key?: string; password?: string }

export function passwordProblem(pw: string): string | null {
  return pw.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : null
}

export function parseIdentity(text: string): string | null {
  return /AGE-SECRET-KEY-1[0-9A-Z]+/.exec(text)?.[0] ?? null
}

/** Short, readable id of a recipient so a backup can say which kit opens it. */
export async function fingerprintOf(recipient: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(recipient)))
  const hex = [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return hex.match(/.{4}/g)!.join("-")
}

export async function protectFile(plainPath: string, destPath: string, cfg: ProtectionConfig, destName: string): Promise<void> {
  try {
    if (cfg.mode === "key") {
      const e = new Encrypter()
      e.addRecipient(cfg.recipient)
      const enc = await e.encrypt(Readable.toWeb(createReadStream(plainPath)) as ReadableStream<Uint8Array>)
      await pipeline(Readable.fromWeb(enc as never), createWriteStream(destPath))
      return
    }
    if (cfg.mode === "password") {
      const problem = passwordProblem(cfg.password)
      if (problem) throw new Error(problem)
      const w = await ArchiveWriter.create(destPath, { password: cfg.password })
      await w.addFile(innerName(destName), plainPath)
      // finish() would add a plaintext manifest.json to the outer zip; close it without one.
      await (w as unknown as { closeWithoutManifest(): Promise<void> }).closeWithoutManifest()
      return
    }
    throw new Error("protectFile called without protection")
  } catch (e) {
    await rm(destPath, { force: true })
    await rm(destPath + ".partial", { force: true })
    throw e
  }
}

export async function detectProtection(p: string): Promise<Protection | "unknown"> {
  const fh = await open(p)
  const head = Buffer.alloc(32)
  try {
    await fh.read(head, 0, 32, 0)
  } finally {
    await fh.close()
  }
  if (head.toString("latin1").startsWith(AGE_MAGIC)) return "key"
  if (head[0] !== 0x50 || head[1] !== 0x4b) return "unknown" // not "PK"
  try {
    const r = await ArchiveReader.open(p)
    const names = r.entries()
    await r.close()
    if (names.includes(MANIFEST_ENTRY)) return "none"
    if (names.length === 1 && /\.(hcbackup|zip)$/.test(names[0])) return "password"
  } catch {
    // an encrypted zip whose directory can't be read without the password
    return "password"
  }
  return "unknown"
}

export async function unprotectFile(src: string, destPlain: string, secret: UnlockSecret): Promise<{ ok: true } | { ok: false; error: string; needs?: "key" | "password" }> {
  const kind = await detectProtection(src)
  if (kind === "unknown") return { ok: false, error: "This isn't a HomeCenter backup." }
  if (kind === "none") return { ok: false, error: "This backup isn't protected." }
  try {
    if (kind === "key") {
      const id = secret.key ? parseIdentity(secret.key) : null
      if (!id) return { ok: false, error: "This backup needs its recovery key.", needs: "key" }
      const d = new Decrypter()
      d.addIdentity(id)
      const out = await d.decrypt(Readable.toWeb(createReadStream(src)) as ReadableStream<Uint8Array>)
      await pipeline(Readable.fromWeb(out as never), createWriteStream(destPlain))
      return { ok: true }
    }
    if (!secret.password) return { ok: false, error: "This backup needs its password.", needs: "password" }
    const r = await ArchiveReader.open(src, secret.password)
    try {
      const [inner] = r.entries()
      await r.extract(inner, destPlain)
    } finally {
      await r.close()
    }
    return { ok: true }
  } catch {
    await rm(destPlain, { force: true })
    return { ok: false, error: kind === "key" ? "That recovery key doesn't open this backup." : "That password doesn't open this backup." }
  }
}
```

Add `closeWithoutManifest()` to `ArchiveWriter` in `lib/backup/archive.ts` (and drop the cast above):
```ts
  /** For wrappers (the outer password zip): no manifest, just close and rename. */
  async closeWithoutManifest(): Promise<void> {
    await this.zip.close()
    this.closed = true
    await rename(this.partialPath, this.finalPath)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/backup` → PASS. If `age-encryption`'s types for `encrypt(stream)` differ (it returns `ReadableStreamWithSize`), keep the `as never` cast on `Readable.fromWeb` only.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/protect.ts lib/backup/protect.test.ts lib/backup/archive.ts
git commit -m "Add recovery-key and password-zip protection for backups"
```

---

### Task 9: Protected backups end to end

**Files:**
- Modify: `lib/backup/backup.ts` (use `protectFile`), `scripts/backup-verify.ts` (unlock flags)
- Test: `lib/backup/backup.test.ts` (new cases)

**Interfaces:**
- Consumes: `protectFile`, `unprotectFile`, `fingerprintOf` (Task 8)
- Produces: `createBackup` supports `key` and `password`; sidecar `keyFingerprint` set for key backups

- [ ] **Step 1: Add failing tests to `lib/backup/backup.test.ts`**

```ts
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { fingerprintOf, unprotectFile } from "./protect"
import { verifyArchive } from "./verify"

describe("protected backups", () => {
  it("key: hides everything, carries secrets, and verifies after unlocking", async () => {
    const s = await setup()
    const id = await generateX25519Identity()
    const recipient = await identityToRecipient(id)
    const fingerprint = await fingerprintOf(recipient)
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "key", recipient, fingerprint }, secrets: { mailPassword: "smtp-pw", llmApiKey: null } })
    expect(out.file).toMatch(/\.hcbackup\.age$/)
    expect(out.sidecar).toMatchObject({ protection: "key", keyFingerprint: fingerprint })
    const plainPath = path.join(s.dir, "unlocked.hcbackup")
    expect(await unprotectFile(out.path, plainPath, { key: id })).toEqual({ ok: true })
    const v = await verifyArchive(plainPath, { workDir: s.workDir })
    expect(v).toMatchObject({ ok: true, manifest: { hasSecrets: true, protection: "key" } })
    const r = await ArchiveReader.open(plainPath)
    expect(JSON.parse(await r.readText("secrets.json"))).toEqual({ mailPassword: "smtp-pw", llmApiKey: null })
    await r.close()
    const { readdir } = await import("node:fs/promises")
    expect(await readdir(s.workDir)).toEqual([]) // no plaintext left behind
  })

  it("password: opens with the password only", async () => {
    const s = await setup()
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "password", password: "abcdef" } })
    expect(out.file).toMatch(/\.hcbackup\.zip$/)
    expect(await unprotectFile(out.path, path.join(s.dir, "x"), { password: "abcdeg" })).toMatchObject({ ok: false })
    expect(await unprotectFile(out.path, path.join(s.dir, "x"), { password: "abcdef" })).toEqual({ ok: true })
  })

  it("an unprotected backup never contains secrets", async () => {
    const s = await setup()
    const out = await createBackup({ ...s, appVersion: "t", protection: { mode: "none" }, secrets: { mailPassword: "smtp-pw", llmApiKey: "k" } })
    const r = await ArchiveReader.open(out.path)
    expect(r.entries()).not.toContain("secrets.json")
    await r.close()
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run lib/backup/backup.test.ts` → the key and password cases FAIL with "Protected backups arrive in a later task."

- [ ] **Step 3: Replace the placeholder in `lib/backup/backup.ts`**

Delete the `protectInto` function and its call; import `protectFile` from `./protect` and use:
```ts
    if (mode !== "none") await protectFile(plainPath, finalPath, input.protection, file)
```

- [ ] **Step 4: Add unlock flags to `scripts/backup-verify.ts`**

First add the shared CLI helper to `lib/backup/protect.ts` (also used by `scripts/restore.ts` in Task 12):
```ts
import path from "node:path"
import { readFile } from "node:fs/promises"

/** CLI: --key <kit file> or --passphrase-env <VAR> (never a password on the command line, where it lands in shell history). */
export async function unlockArgs(args: string[]): Promise<UnlockSecret> {
  const k = args.indexOf("--key")
  const p = args.indexOf("--passphrase-env")
  return {
    key: k >= 0 ? await readFile(path.resolve(args[k + 1]), "utf8") : undefined,
    password: p >= 0 ? process.env[args[p + 1]] : undefined,
  }
}
```
Then `scripts/backup-verify.ts`:
```ts
// npm run backup:verify -- <file> [--key kit.txt | --passphrase-env VAR]
import path from "node:path"
import { rm } from "node:fs/promises"
import { verifyArchive } from "../lib/backup/verify"
import { workDir } from "../lib/backup/paths"
import { detectProtection, unlockArgs, unprotectFile } from "../lib/backup/protect"

async function main() {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file) throw new Error("Usage: npm run backup:verify -- <file> [--key kit.txt | --passphrase-env VAR]")
  let target = path.resolve(file)
  let temp: string | null = null
  if ((await detectProtection(target)) !== "none") {
    temp = path.join(workDir(), `verify-cli-${Date.now()}.hcbackup`)
    const u = await unprotectFile(target, temp, await unlockArgs(args))
    if (!u.ok) throw new Error(u.error)
    target = temp
  }
  try {
    const r = await verifyArchive(target, { workDir: workDir() })
    if (!r.ok) throw new Error(r.error)
    console.log(`OK: ${r.manifest.files.length} entries, made ${r.manifest.createdAt} by HomeCenter ${r.manifest.appVersion}.`)
  } finally {
    if (temp) await rm(temp, { force: true })
  }
}

main().catch((e) => {
  console.error(`Not OK: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
```

- [ ] **Step 5: Run tests, commit**

Run: `npm test; npx tsc --noEmit`
```bash
git add lib/backup/backup.ts lib/backup/backup.test.ts lib/backup/protect.ts scripts/backup-verify.ts
git commit -m "Protect backups with a recovery key or password and carry secrets"
```

---

### Task 10: Protection settings UI (choose, recovery kit, password)

**Files:**
- Create: `components/settings/data/backup-protection.tsx`, `components/settings/data/recovery-kit.ts`
- Modify: `lib/actions/backup.ts`, `components/settings/data/data-settings.tsx`

**Interfaces:**
- Consumes: `fingerprintOf`, `passwordProblem` (Task 8; both are browser-safe, `protect.ts` must therefore not be imported by client code because it imports `node:fs` — put the two pure helpers in `lib/backup/protect-shared.ts` and re-export them from `protect.ts`)
- Produces actions: `setProtectionNone(): Promise<{ ok: true } | { error: string }>`, `setProtectionKey(input: { publicKey: string; fingerprint: string }): Promise<{ ok: true } | { error: string }>`, `setProtectionPassword(input: { password: string }): Promise<{ ok: true } | { error: string }>`; `recoveryKitText(input: { identity: string; recipient: string; fingerprint: string; created: Date }): string`

- [ ] **Step 1: Split browser-safe helpers**

Create `lib/backup/protect-shared.ts` with `MIN_PASSWORD` import from `./format`, and move `passwordProblem`, `parseIdentity`, `fingerprintOf` into it unchanged; in `protect.ts` replace their bodies with `export { passwordProblem, parseIdentity, fingerprintOf } from "./protect-shared"`. Run `npx vitest run lib/backup/protect.test.ts` → PASS.

- [ ] **Step 2: Add the actions to `lib/actions/backup.ts`**

```ts
import { encrypt } from "@/lib/secret-box"
import { fingerprintOf, passwordProblem } from "@/lib/backup/protect-shared"

export async function setProtectionNone(): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  await prisma.backupSettings.update({ where: { id: BACKUP_SETTINGS_ID }, data: { protection: "NONE", passphraseEnc: null } })
  revalidatePath("/settings")
  return { ok: true }
}

export async function setProtectionKey(input: { publicKey: string; fingerprint: string }): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  const key = input.publicKey.trim()
  if (!/^age1[0-9a-z]{20,}$/.test(key)) return { error: "That isn't a recovery key's public half." }
  // Recomputed here: the client's fingerprint is only trusted if it matches.
  if ((await fingerprintOf(key)) !== input.fingerprint) return { error: "The key and its fingerprint don't match." }
  await prisma.backupSettings.update({
    where: { id: BACKUP_SETTINGS_ID },
    data: { protection: "KEY", publicKey: key, keyFingerprint: input.fingerprint, passphraseEnc: null },
  })
  revalidatePath("/settings")
  return { ok: true }
}

export async function setProtectionPassword(input: { password: string }): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  const problem = passwordProblem(input.password)
  if (problem) return { error: problem }
  await prisma.backupSettings.update({
    where: { id: BACKUP_SETTINGS_ID },
    data: { protection: "PASSWORD", passphraseEnc: encrypt(input.password) },
  })
  revalidatePath("/settings")
  return { ok: true }
}
```

- [ ] **Step 3: Write `components/settings/data/recovery-kit.ts`**

```ts
export function recoveryKitText(i: { identity: string; recipient: string; fingerprint: string; created: Date }): string {
  return [
    "HomeCenter backup recovery key",
    "================================",
    "",
    `Created:     ${i.created.toLocaleString()}`,
    `Fingerprint: ${i.fingerprint}`,
    "",
    "Keep this file somewhere safe and separate from your server: a password manager,",
    "a USB stick in a drawer, or printed. Anyone with it can open backups made with",
    "this key. Without it, those backups can't be opened by anyone, including you.",
    "",
    "Your recovery key:",
    "",
    i.identity,
    "",
    "Public half (stored on the server, safe to share):",
    i.recipient,
    "",
    "To restore in HomeCenter: Settings > Data > Restore, choose the backup, then",
    "choose this file (or paste the key) when asked.",
    "",
    "To open a backup without HomeCenter, install age (https://age-encryption.org) and run:",
    "  age -d -i homecenter-recovery-key.txt homecenter-YYYY-MM-DD-HHmm.hcbackup.age > backup.zip",
    "backup.zip then opens in any zip tool; readable/index.html shows everything.",
    "",
  ].join("\n")
}
```

- [ ] **Step 4: Write `components/settings/data/backup-protection.tsx`**

```tsx
"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { KeyRound, Lock, ShieldOff, Download } from "lucide-react"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { setProtectionKey, setProtectionNone, setProtectionPassword } from "@/lib/actions/backup"
import { fingerprintOf, passwordProblem } from "@/lib/backup/protect-shared"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { recoveryKitText } from "./recovery-kit"

type Mode = "NONE" | "KEY" | "PASSWORD"
const OPTIONS: { mode: Mode; icon: React.ElementType; title: string; body: string }[] = [
  { mode: "NONE", icon: ShieldOff, title: "No protection", body: "Plain zip. Opens anywhere. Anyone who gets the file can read it." },
  { mode: "KEY", icon: KeyRound, title: "Recovery key", body: "You keep a key file. The server can make backups but can't open them. Strongest." },
  { mode: "PASSWORD", icon: Lock, title: "Password zip", body: "Opens in 7-Zip, WinRAR or Keka with your password. The server stores the password to make scheduled backups." },
]

export function BackupProtection({ data, onSaved }: { data: BackupOverview; onSaved: () => Promise<void> }) {
  const current = data.settings.protection
  const [dialog, setDialog] = useState<Mode | null>(null)
  const [pending, start] = useTransition()

  function choose(mode: Mode) {
    if (mode === current && mode !== "KEY" && mode !== "PASSWORD") return
    if (mode === "NONE") {
      if (!window.confirm("Turn protection off? New backups will be readable by anyone who gets the file. Existing protected backups stay protected.")) return
      start(async () => {
        const r = await setProtectionNone()
        if ("error" in r) toast.error(r.error)
        else toast.success("Protection turned off for new backups.")
        await onSaved()
      })
      return
    }
    setDialog(mode)
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Protection</CardTitle>
        <CardDescription>Applies to new backups. Each backup in the list shows how it was protected.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            disabled={pending}
            onClick={() => choose(o.mode)}
            aria-pressed={current === o.mode}
            className={cn("rounded-lg border p-3 text-left transition-colors hover:bg-muted/50", current === o.mode && "border-primary ring-1 ring-primary")}
          >
            <span className="flex items-center gap-2 text-sm font-medium"><o.icon className="h-4 w-4" aria-hidden="true" />{o.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{o.body}</span>
            {current === o.mode && o.mode === "KEY" && data.settings.keyFingerprint && (
              <span className="mt-2 block text-xs">Key {data.settings.keyFingerprint} · <span className="underline">make a new key</span></span>
            )}
            {current === o.mode && o.mode === "PASSWORD" && <span className="mt-2 block text-xs underline">Change password</span>}
          </button>
        ))}
      </CardContent>
      {dialog === "KEY" && <KeyDialog onClose={() => setDialog(null)} onSaved={onSaved} replacing={current === "KEY"} />}
      {dialog === "PASSWORD" && <PasswordDialog onClose={() => setDialog(null)} onSaved={onSaved} />}
    </Card>
  )
}

function KeyDialog({ onClose, onSaved, replacing }: { onClose: () => void; onSaved: () => Promise<void>; replacing: boolean }) {
  const [kit, setKit] = useState<{ identity: string; recipient: string; fingerprint: string } | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  async function make() {
    // Generated here, in the browser: only the public half is ever sent.
    const identity = await generateX25519Identity()
    const recipient = await identityToRecipient(identity)
    setKit({ identity, recipient, fingerprint: await fingerprintOf(recipient) })
  }

  function download() {
    if (!kit) return
    const blob = new Blob([recoveryKitText({ ...kit, created: new Date() })], { type: "text/plain" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "homecenter-recovery-key.txt"
    a.click()
    URL.revokeObjectURL(a.href)
    setDownloaded(true)
  }

  function finish() {
    if (!kit) return
    start(async () => {
      const r = await setProtectionKey({ publicKey: kit.recipient, fingerprint: kit.fingerprint })
      if ("error" in r) return void toast.error(r.error)
      toast.success(`Recovery key ${kit.fingerprint} is now used for new backups.`)
      setKit(null) // drop the private key from memory
      await onSaved()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{replacing ? "Make a new recovery key" : "Set up a recovery key"}</DialogTitle>
          <DialogDescription>
            HomeCenter makes the key in this browser and keeps only its public half. You download the key itself, once.
            {replacing ? " Older backups still need the old key file." : ""}
          </DialogDescription>
        </DialogHeader>
        {!kit ? (
          <Button onClick={() => void make()}>Make my key</Button>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Fingerprint <span className="font-mono">{kit.fingerprint}</span></p>
            <Button variant="outline" onClick={download}><Download className="h-4 w-4" aria-hidden="true" />Download recovery key</Button>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={saved} disabled={!downloaded} onChange={(e) => setSaved(e.target.checked)} />
              <span>I saved the key somewhere other than this server. I understand backups made with it can't be opened without it.</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!kit || !saved || pending} onClick={finish}>Use this key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [pw, setPw] = useState("")
  const [again, setAgain] = useState("")
  const [pending, start] = useTransition()
  const problem = pw ? passwordProblem(pw) : null
  const mismatch = again && pw !== again ? "The passwords don't match." : null

  function save(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await setProtectionPassword({ password: pw })
      if ("error" in r) return void toast.error(r.error)
      toast.success("New backups will be password zips.")
      await onSaved()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Password for backups</DialogTitle>
            <DialogDescription>
              At least 6 characters. HomeCenter stores it encrypted to make scheduled backups, so anyone with both your data folder and AUTH_SECRET could open them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bk-pw">Password</Label>
            <Input id="bk-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            {problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-pw2">Same password again</Label>
            <Input id="bk-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            {mismatch && <p className="text-xs text-destructive">{mismatch}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || !pw || !!problem || pw !== again}>Save password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```
Add `<BackupProtection data={data} onSaved={refresh} />` to `DataSettings` between `BackupSchedule` and `BackupList`.

- [ ] **Step 5: Checks and browser pass**

Run: `npm test; npx tsc --noEmit; npm run lint`.
Scratch server (as Task 6 Step 9), Playwright:
1. Recovery key: Make my key → Download (assert a download named `homecenter-recovery-key.txt` containing `AGE-SECRET-KEY-1`) → checkbox enabled only after download → Use this key → card shows fingerprint. Back up now → list row shows "Recovery key <fingerprint>" and file ends `.hcbackup.age`. Check shows "File intact…".
2. Password: "12345" shows "Use at least 6 characters."; "abcdef" twice → saved; Back up now → `.hcbackup.zip`; the downloaded file opens in Node with zip.js + "abcdef" (script in scratch), outer entry is a single `.hcbackup` name.
3. No protection: confirm dialog → notice reappears on the status card.
4. Phone width and dark theme: dialogs fit, no horizontal scroll.

- [ ] **Step 6: Commit**

```bash
git add lib/backup/protect-shared.ts lib/backup/protect.ts lib/actions/backup.ts components/settings/data
git commit -m "Add protection choice with recovery kit and password zip setup"
```

---

# Slice 3 — Restore

### Task 11: Restore engine (dry run, stage, apply with rollback, undo)

**Files:**
- Create: `lib/backup/restore.ts`
- Test: `lib/backup/restore.test.ts`

**Interfaces:**
- Consumes: `verifyArchive`, `checkCompatibility` (Task 3); `unprotectFile`, `detectProtection` (Task 8); `ArchiveReader` (Task 2); `modelCounts`, `openDb` (Task 3); `encrypt`, `decrypt` (`../secret-box`); `safeJoin` (Task 1)
- Produces:
  - `type RestorePaths = { dbPath: string; uploadDir: string; restoreDir: string; searchIndexPath: string }`
  - `type SecretsStatus = "carried" | "same-secret" | "re-enter" | "none"`
  - `type DryRun = { ok: true; manifest: Manifest; backupCounts: Record<string, number>; currentCounts: Record<string, number>; secrets: SecretsStatus; warnings: string[] } | { ok: false; error: string; needs?: "key" | "password" }`
  - `dryRun(i: { archivePath: string; secret: UnlockSecret; paths: RestorePaths; known: string[] }): Promise<DryRun>` (leaves `restore/work/archive.hcbackup` + `restore/work/dryrun.json` for `stage`)
  - `stage(i: { paths: RestorePaths; now?: Date }): Promise<void>`
  - `stageUndo(i: { paths: RestorePaths; now?: Date }): Promise<void>`
  - `latestPre(restoreDir: string): Promise<{ dir: string; createdAt: string } | null>`
  - `cancelRestore(restoreDir: string): Promise<void>`
  - `type RestoreResult = { status: "ok" | "failed"; error: string | null; backupCreatedAt: string | null; appliedAt: string; source: "backup" | "undo"; finalized: boolean }`
  - `applyPending(paths: RestorePaths, now?: Date, fsOps?: { rename: typeof rename }): Promise<{ applied: false } | { applied: true; result: RestoreResult }>`
  - `readResult(restoreDir): Promise<RestoreResult | null>`, `markFinalized(restoreDir): Promise<void>`, `prunePre(restoreDir, now, days = 7): Promise<number>`
  - `hasPending(restoreDir): Promise<boolean>`

- [ ] **Step 1: Write the failing test `lib/backup/restore.test.ts`**

```ts
import { describe, expect, it, beforeAll } from "vitest"
import path from "node:path"
import { existsSync } from "node:fs"
import { readFile, rename, writeFile } from "node:fs/promises"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { createBackup } from "./backup"
import { appMigrations } from "./paths"
import { applyPending, dryRun, latestPre, readResult, stage, stageUndo, type RestorePaths } from "./restore"
import { modelCounts, openDb } from "./snapshot"
import { fingerprintOf } from "./protect"
import { createMigratedDb, seedSample, SAMPLE_FILES, tempDir } from "./test-support"
import { decrypt, encrypt } from "../secret-box"

beforeAll(() => {
  process.env.AUTH_SECRET ??= "test-secret-for-restore-tests"
})

/** Source household with a backup; target household with different data. */
async function world(protection: "none" | "key" | "password" = "none") {
  const src = await tempDir("hc-src-")
  const srcDb = path.join(src, "homecenter.db")
  await createMigratedDb(srcDb)
  await seedSample(srcDb, path.join(src, "uploads"))
  let secret = {}
  let cfg: Parameters<typeof createBackup>[0]["protection"] = { mode: "none" }
  if (protection === "key") {
    const id = await generateX25519Identity()
    const recipient = await identityToRecipient(id)
    cfg = { mode: "key", recipient, fingerprint: await fingerprintOf(recipient) }
    secret = { key: id }
  } else if (protection === "password") {
    cfg = { mode: "password", password: "abcdef" }
    secret = { password: "abcdef" }
  }
  const backup = await createBackup({
    dbPath: srcDb, uploadDir: path.join(src, "uploads"), folder: path.join(src, "backups"), workDir: path.join(src, "work"),
    appVersion: "t", protection: cfg, secrets: { mailPassword: "smtp-pw", llmApiKey: null },
  })

  const dst = await tempDir("hc-dst-")
  const paths: RestorePaths = {
    dbPath: path.join(dst, "homecenter.db"), uploadDir: path.join(dst, "uploads"),
    restoreDir: path.join(dst, "restore"), searchIndexPath: path.join(dst, "search-index.db"),
  }
  await createMigratedDb(paths.dbPath)
  await writeFile(paths.searchIndexPath, "index")
  const c = openDb(paths.dbPath)
  await c.execute(`INSERT INTO "User" (id, name, email, passwordHash, role) VALUES ('other', 'Other', 'o@example.test', 'h', 'ADMIN')`)
  c.close()
  const { writeFiles } = await import("./test-support")
  await writeFiles(paths.uploadDir, { "service/zz/old.pdf": "old" })
  return { backup, paths, secret }
}

describe("restore", () => {
  it.each(["none", "key", "password"] as const)("round-trips a %s backup into another household", async (protection) => {
    const { backup, paths, secret } = await world(protection)
    const known = await appMigrations()
    const d = await dryRun({ archivePath: backup.path, secret, paths, known })
    expect(d).toMatchObject({ ok: true, secrets: protection === "none" ? "none" : "carried" })
    if (!d.ok) return
    expect(d.backupCounts.ServiceRecord).toBe(2)
    expect(d.currentCounts.User).toBe(1)

    await stage({ paths })
    const r = await applyPending(paths)
    expect(r).toMatchObject({ applied: true, result: { status: "ok" } })

    expect((await modelCounts(paths.dbPath)).ServiceRecord).toBe(2)
    for (const f of SAMPLE_FILES) expect(existsSync(path.join(paths.uploadDir, ...f.split("/")))).toBe(true)
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(false)
    expect(existsSync(paths.searchIndexPath)).toBe(false) // rebuilt on boot
    expect(await latestPre(paths.restoreDir)).not.toBeNull()
    if (protection !== "none") {
      const enc = JSON.parse(await readFile(path.join(paths.restoreDir, "secrets.enc.json"), "utf8"))
      expect(decrypt(enc.mailPasswordEnc)).toBe("smtp-pw")
    }
  })

  it("asks for the key or password, and rejects a wrong one without staging", async () => {
    const { backup, paths } = await world("password")
    const known = await appMigrations()
    expect(await dryRun({ archivePath: backup.path, secret: {}, paths, known })).toMatchObject({ ok: false, needs: "password" })
    expect(await dryRun({ archivePath: backup.path, secret: { password: "nope12" }, paths, known })).toMatchObject({ ok: false, error: expect.stringContaining("doesn't open") })
    await expect(stage({ paths })).rejects.toThrow()
  })

  it("rolls back when apply fails part way", async () => {
    const { backup, paths } = await world()
    await dryRun({ archivePath: backup.path, secret: {}, paths, known: await appMigrations() })
    await stage({ paths })
    let calls = 0
    const flaky = async (a: string, b: string) => {
      if (++calls === 4) throw new Error("disk went away")
      await rename(a, b)
    }
    const r = await applyPending(paths, new Date(), { rename: flaky as typeof rename })
    expect(r).toMatchObject({ applied: true, result: { status: "failed", error: "disk went away" } })
    expect((await modelCounts(paths.dbPath)).User).toBe(1) // the original household
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
    expect(await readResult(paths.restoreDir)).toMatchObject({ status: "failed" })
    expect(await applyPending(paths)).toEqual({ applied: false }) // nothing left pending
  })

  it("undo brings back the household from before the restore", async () => {
    const { backup, paths } = await world()
    await dryRun({ archivePath: backup.path, secret: {}, paths, known: await appMigrations() })
    await stage({ paths })
    await applyPending(paths)
    await stageUndo({ paths })
    await applyPending(paths)
    expect((await modelCounts(paths.dbPath)).ServiceRecord).toBe(0)
    expect(existsSync(path.join(paths.uploadDir, "service/zz/old.pdf"))).toBe(true)
    expect(await readResult(paths.restoreDir)).toMatchObject({ status: "ok", source: "undo" })
  })

  it("accepts an older-schema backup (migrations upgrade it at boot)", async () => {
    const known = await appMigrations()
    const older = known.at(-2)!
    const src = await tempDir()
    const db = path.join(src, "homecenter.db")
    await createMigratedDb(db, { upTo: older })
    const b = await createBackup({ dbPath: db, uploadDir: path.join(src, "u"), folder: path.join(src, "b"), workDir: path.join(src, "w"), appVersion: "t", protection: { mode: "none" } })
    const { paths } = await world()
    expect(await dryRun({ archivePath: b.path, secret: {}, paths, known })).toMatchObject({ ok: true, manifest: { migration: older } })
  })

  it("reports secrets status for an unprotected backup", async () => {
    const src = await tempDir()
    const db = path.join(src, "homecenter.db")
    await createMigratedDb(db)
    const c = openDb(db)
    await c.execute({ sql: `INSERT INTO "MailSettings" (id, passwordEnc, updatedAt) VALUES ('singleton', ?, CURRENT_TIMESTAMP)`, args: [encrypt("pw")] })
    c.close()
    const b = await createBackup({ dbPath: db, uploadDir: path.join(src, "u"), folder: path.join(src, "b"), workDir: path.join(src, "w"), appVersion: "t", protection: { mode: "none" } })
    const { paths } = await world()
    expect(await dryRun({ archivePath: b.path, secret: {}, paths, known: await appMigrations() })).toMatchObject({ ok: true, secrets: "same-secret" })
    process.env.AUTH_SECRET = "a-different-secret"
    expect(await dryRun({ archivePath: b.path, secret: {}, paths, known: await appMigrations() })).toMatchObject({ ok: true, secrets: "re-enter" })
    process.env.AUTH_SECRET = "test-secret-for-restore-tests"
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/backup/restore.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `lib/backup/restore.ts`**

```ts
// Engine file: relative imports and npm packages only. applyPending runs from
// scripts/restore-apply.ts before migrations, with no app code loaded.
import path from "node:path"
import { mkdir, readdir, readFile, rename as fsRename, rm, stat, statfs, writeFile } from "node:fs/promises"
import { encrypt, decrypt } from "../secret-box"
import { ArchiveReader } from "./archive"
import { DB_ENTRY, FILES_PREFIX, SECRETS_ENTRY, type Manifest } from "./format"
import { safeJoin } from "./paths"
import { detectProtection, unprotectFile, type UnlockSecret } from "./protect"
import { modelCounts, openDb } from "./snapshot"
import { checkCompatibility, verifyArchive } from "./verify"

export type RestorePaths = { dbPath: string; uploadDir: string; restoreDir: string; searchIndexPath: string }
export type SecretsStatus = "carried" | "same-secret" | "re-enter" | "none"
export type DryRun =
  | { ok: true; manifest: Manifest; backupCounts: Record<string, number>; currentCounts: Record<string, number>; secrets: SecretsStatus; warnings: string[] }
  | { ok: false; error: string; needs?: "key" | "password" }
export type RestoreResult = { status: "ok" | "failed"; error: string | null; backupCreatedAt: string | null; appliedAt: string; source: "backup" | "undo"; finalized: boolean }

const exists = (p: string) => stat(p).then(() => true, () => false)
const dirs = (r: string) => ({
  work: path.join(r, "work"), staging: path.join(r, "staging"), pending: path.join(r, "pending.json"),
  result: path.join(r, "result.json"), secrets: path.join(r, "secrets.enc.json"),
})

async function secretsStatus(dbFile: string, manifest: Manifest): Promise<SecretsStatus> {
  if (manifest.hasSecrets) return "carried"
  const c = openDb(dbFile)
  try {
    const mail = await c.execute(`SELECT passwordEnc AS v FROM "MailSettings"`).catch(() => ({ rows: [] }))
    const llm = await c.execute(`SELECT apiKeyEnc AS v FROM "LlmSettings"`).catch(() => ({ rows: [] }))
    const stored = [...mail.rows, ...llm.rows].map((r) => r.v as string | null).filter((v): v is string => !!v)
    if (stored.length === 0) return "none"
    return stored.every((v) => decrypt(v) !== null) ? "same-secret" : "re-enter"
  } finally {
    c.close()
  }
}

export async function dryRun(i: { archivePath: string; secret: UnlockSecret; paths: RestorePaths; known: string[] }): Promise<DryRun> {
  const d = dirs(i.paths.restoreDir)
  await rm(d.work, { recursive: true, force: true })
  await mkdir(d.work, { recursive: true })

  const size = (await stat(i.archivePath)).size
  const fs = await statfs(i.paths.restoreDir)
  if (Number(fs.bavail) * Number(fs.bsize) < size * 2) return { ok: false, error: "Not enough free disk space to restore this backup (about twice its size is needed)." }

  const kind = await detectProtection(i.archivePath)
  if (kind === "unknown") return { ok: false, error: "This isn't a HomeCenter backup." }
  const plain = path.join(d.work, "archive.hcbackup")
  if (kind === "none") {
    // Keep the source where it is; stage reads it from dryrun.json.
  } else {
    const u = await unprotectFile(i.archivePath, plain, i.secret)
    if (!u.ok) return u
  }
  const archive = kind === "none" ? i.archivePath : plain

  const v = await verifyArchive(archive, { workDir: d.work })
  if (!v.ok) return { ok: false, error: v.error }
  const compat = checkCompatibility(v.manifest, i.known)
  if (!compat.ok) return { ok: false, error: compat.reason }

  const r = await ArchiveReader.open(archive)
  const check = path.join(d.work, "check.db")
  try {
    await r.extract(DB_ENTRY, check)
  } finally {
    await r.close()
  }
  const [backupCounts, currentCounts, secrets] = await Promise.all([modelCounts(check), modelCounts(i.paths.dbPath), secretsStatus(check, v.manifest)])
  await rm(check, { force: true })
  await writeFile(path.join(d.work, "dryrun.json"), JSON.stringify({ archive, createdAt: v.manifest.createdAt }))
  return { ok: true, manifest: v.manifest, backupCounts, currentCounts, secrets, warnings: v.manifest.warnings }
}

async function removePre(restoreDir: string, except?: string) {
  for (const n of await readdir(restoreDir).catch(() => [] as string[])) {
    if (n.startsWith("pre-") && path.join(restoreDir, n) !== except) await rm(path.join(restoreDir, n), { recursive: true, force: true })
  }
}

export async function stage(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  const info = JSON.parse(await readFile(path.join(d.work, "dryrun.json"), "utf8")) as { archive: string; createdAt: string }
  await removePre(i.paths.restoreDir) // a new restore replaces the undo point
  await rm(d.staging, { recursive: true, force: true })
  await mkdir(path.join(d.staging, "uploads"), { recursive: true })

  const r = await ArchiveReader.open(info.archive)
  try {
    const manifest = await r.manifest()
    await r.extract(DB_ENTRY, path.join(d.staging, "homecenter.db"))
    for (const f of manifest.files) {
      if (!f.path.startsWith(FILES_PREFIX)) continue
      const dest = safeJoin(path.join(d.staging, "uploads"), f.path.slice(FILES_PREFIX.length))
      if (!dest) throw new Error(`Unsafe path in the backup: ${f.path}`)
      await r.extract(f.path, dest)
    }
    if (manifest.hasSecrets) {
      const s = JSON.parse(await r.readText(SECRETS_ENTRY)) as { mailPassword: string | null; llmApiKey: string | null }
      // Re-wrapped under this server's AUTH_SECRET at once, so plaintext never rests on disk.
      await writeFile(path.join(d.staging, "secrets.enc.json"), JSON.stringify({
        mailPasswordEnc: s.mailPassword ? encrypt(s.mailPassword) : null,
        llmApiKeyEnc: s.llmApiKey ? encrypt(s.llmApiKey) : null,
      }))
    }
  } finally {
    await r.close()
  }
  await writeFile(d.pending, JSON.stringify({ createdAt: (i.now ?? new Date()).toISOString(), backupCreatedAt: info.createdAt, source: "backup" }))
  await rm(d.work, { recursive: true, force: true })
}

export async function latestPre(restoreDir: string): Promise<{ dir: string; createdAt: string } | null> {
  const names = (await readdir(restoreDir).catch(() => [] as string[])).filter((n) => n.startsWith("pre-")).sort()
  const last = names.at(-1)
  if (!last) return null
  const dir = path.join(restoreDir, last)
  const meta = await readFile(path.join(dir, "pre.json"), "utf8").then((t) => JSON.parse(t) as { createdAt: string }, () => null)
  return meta ? { dir, createdAt: meta.createdAt } : null
}

export async function stageUndo(i: { paths: RestorePaths; now?: Date }): Promise<void> {
  const d = dirs(i.paths.restoreDir)
  const pre = await latestPre(i.paths.restoreDir)
  if (!pre) throw new Error("There's no earlier state to go back to.")
  await rm(d.staging, { recursive: true, force: true })
  await fsRename(pre.dir, d.staging)
  if (!(await exists(path.join(d.staging, "uploads")))) await mkdir(path.join(d.staging, "uploads"))
  await writeFile(d.pending, JSON.stringify({ createdAt: (i.now ?? new Date()).toISOString(), backupCreatedAt: pre.createdAt, source: "undo" }))
}

export async function cancelRestore(restoreDir: string): Promise<void> {
  const d = dirs(restoreDir)
  await rm(d.work, { recursive: true, force: true })
  await rm(path.join(restoreDir, "incoming"), { recursive: true, force: true })
}

export const hasPending = (restoreDir: string) => exists(dirs(restoreDir).pending)

async function writeResult(restoreDir: string, r: RestoreResult) {
  await writeFile(dirs(restoreDir).result, JSON.stringify(r, null, 2))
}

export async function readResult(restoreDir: string): Promise<RestoreResult | null> {
  return readFile(dirs(restoreDir).result, "utf8").then((t) => JSON.parse(t) as RestoreResult, () => null)
}

export async function markFinalized(restoreDir: string): Promise<void> {
  const r = await readResult(restoreDir)
  if (r) await writeResult(restoreDir, { ...r, finalized: true })
}

export async function prunePre(restoreDir: string, now: Date, days = 7): Promise<number> {
  const pre = await latestPre(restoreDir)
  if (!pre || now.getTime() - new Date(pre.createdAt).getTime() < days * 86_400_000) return 0
  await rm(pre.dir, { recursive: true, force: true })
  return 1
}

const safeStamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-")

/** Swap the staged household in. Runs before Prisma connects (boot script or CLI). Any failure puts everything back. */
export async function applyPending(paths: RestorePaths, now = new Date(), fsOps: { rename: typeof fsRename } = { rename: fsRename }): Promise<{ applied: false } | { applied: true; result: RestoreResult }> {
  const d = dirs(paths.restoreDir)
  if (!(await exists(d.pending))) return { applied: false }
  const meta = JSON.parse(await readFile(d.pending, "utf8")) as { backupCreatedAt: string | null; source: "backup" | "undo" }
  const pre = path.join(paths.restoreDir, `pre-${safeStamp(now)}`)
  const moves: [from: string, to: string][] = []
  const move = async (from: string, to: string) => {
    await fsOps.rename(from, to)
    moves.push([from, to])
  }
  const base: Omit<RestoreResult, "status" | "error"> = { backupCreatedAt: meta.backupCreatedAt, appliedAt: now.toISOString(), source: meta.source, finalized: false }

  try {
    if (!(await exists(path.join(d.staging, "homecenter.db")))) throw new Error("The staged backup has no database.")
    await mkdir(pre, { recursive: true })
    await writeFile(path.join(pre, "pre.json"), JSON.stringify({ createdAt: now.toISOString() }))
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      if (await exists(paths.dbPath + suffix)) await move(paths.dbPath + suffix, path.join(pre, "homecenter.db" + suffix))
    }
    if (await exists(paths.uploadDir)) await move(paths.uploadDir, path.join(pre, "uploads"))
    await move(path.join(d.staging, "homecenter.db"), paths.dbPath)
    await move(path.join(d.staging, "uploads"), paths.uploadDir)
    if (await exists(path.join(d.staging, "secrets.enc.json"))) await move(path.join(d.staging, "secrets.enc.json"), d.secrets)
  } catch (e) {
    for (const [from, to] of moves.reverse()) {
      try {
        await fsRename(to, from)
      } catch {
        // best effort: the error below says what happened
      }
    }
    await rm(pre, { recursive: true, force: true })
    await rm(d.staging, { recursive: true, force: true })
    await rm(d.pending, { force: true })
    const result: RestoreResult = { ...base, status: "failed", error: e instanceof Error ? e.message : String(e) }
    await writeResult(paths.restoreDir, result)
    return { applied: true, result }
  }

  for (const suffix of ["", "-wal", "-shm"]) await rm(paths.searchIndexPath + suffix, { force: true })
  await rm(d.staging, { recursive: true, force: true })
  await rm(d.pending, { force: true })
  const result: RestoreResult = { ...base, status: "ok", error: null }
  await writeResult(paths.restoreDir, result)
  return { applied: true, result }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/backup` → PASS. In the rollback test the renames are: live DB → pre (1), live uploads → pre (2), staged DB → live (3), staged uploads → live (4, throws). So the failure lands after the new DB is in place and before its files are, the worst moment, and the test proves everything moves back.

- [ ] **Step 5: Commit**

```bash
git add lib/backup/restore.ts lib/backup/restore.test.ts
git commit -m "Add restore engine with dry run, staged apply, rollback and undo"
```

---

### Task 12: Apply at boot, finalize, CLI restore

**Files:**
- Create: `scripts/restore-apply.ts`, `scripts/restore.ts`, `lib/backup/restore-server.ts`
- Modify: `docker-entrypoint.sh`, `package.json`, `instrumentation.ts`

**Interfaces:**
- Consumes: Task 11; `prisma`; `raiseBackupAlert`-style admin notification
- Produces: `restorePaths(): RestorePaths` (server env), `finalizeRestore(): Promise<void>`, `restartToFinish(): { restarting: boolean }` helper used by actions in Task 13

- [ ] **Step 1: Write `scripts/restore-apply.ts`**

```ts
// Runs before `prisma migrate deploy` (docker-entrypoint.sh, npm prestart/predev).
// Swaps in a staged restore while nothing has the database open. Never throws:
// a failure is rolled back and recorded for the app to report.
import { applyPending } from "../lib/backup/restore"
import { dbPathFromUrl, restoreDir, searchIndexFile, uploadDir } from "../lib/backup/paths"

async function main() {
  if (!process.env.DATABASE_URL) return
  const r = await applyPending({
    dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile(),
  })
  if (!r.applied) return
  if (r.result.status === "ok") console.log(`[restore] applied backup from ${r.result.backupCreatedAt}`)
  else console.error(`[restore] failed and rolled back: ${r.result.error}`)
}

main().catch((e) => console.error("[restore] apply step crashed:", e))
```

- [ ] **Step 2: Hook it in**

`docker-entrypoint.sh`, before `gosu nextjs npx prisma migrate deploy`:
```sh
gosu nextjs npx tsx scripts/restore-apply.ts
```
`package.json` scripts:
```json
    "predev": "tsx scripts/restore-apply.ts && prisma migrate deploy",
    "prestart": "tsx scripts/restore-apply.ts",
    "restore": "tsx scripts/restore.ts",
```

- [ ] **Step 3: Write `lib/backup/restore-server.ts`**

```ts
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { prisma } from "@/lib/prisma"
import { SETTINGS_ID } from "@/lib/notifications/mail-config"
import { notificationService } from "@/lib/notifications/channels"
import { dbPathFromUrl, restoreDir, searchIndexFile, uploadDir } from "./paths"
import { markFinalized, prunePre, readResult, type RestorePaths } from "./restore"
import { BACKUP_ENTITY } from "./alerts-server"

export const restorePaths = (): RestorePaths => ({
  dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile(),
})

/** After boot (migrations done): finish what the apply step started. Idempotent. */
export async function finalizeRestore(now = new Date()): Promise<void> {
  const dir = restoreDir()
  const result = await readResult(dir)
  if (result && !result.finalized) {
    if (result.status === "ok") {
      const secretsFile = path.join(dir, "secrets.enc.json")
      const secrets = await readFile(secretsFile, "utf8").then((t) => JSON.parse(t) as { mailPasswordEnc: string | null; llmApiKeyEnc: string | null }, () => null)
      if (secrets?.mailPasswordEnc) await prisma.mailSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, passwordEnc: secrets.mailPasswordEnc }, update: { passwordEnc: secrets.mailPasswordEnc } })
      if (secrets?.llmApiKeyEnc) await prisma.llmSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", apiKeyEnc: secrets.llmApiKeyEnc }, update: { apiKeyEnc: secrets.llmApiKeyEnc } })
      await rm(secretsFile, { force: true })
      // Everyone signs in again, with the accounts in the restored data.
      await prisma.user.updateMany({ data: { sessionVersion: { increment: 1 } } })
      // The run that made this backup was RUNNING when it was snapshotted; its real record is the file.
      await prisma.backupRun.deleteMany({ where: { status: "RUNNING" } })
    }
    const when = result.backupCreatedAt ? new Date(result.backupCreatedAt).toLocaleString() : "an earlier state"
    await prisma.backupRun.create({
      data: { kind: "RESTORE", trigger: "MANUAL", status: result.status === "ok" ? "OK" : "FAILED", startedAt: new Date(result.appliedAt), finishedAt: now, error: result.error },
    })
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })
    for (const a of admins) {
      await notificationService.send({
        userId: a.id, type: "CUSTOM", relatedEntityType: BACKUP_ENTITY, cycleKey: `restore:${result.appliedAt}`,
        title: result.status === "ok" ? (result.source === "undo" ? "Restore undone" : `Restored from the backup of ${when}`) : "Restore didn't finish",
        message: result.status === "ok" ? "Everyone was signed out. Sign in with the accounts from that backup." : `${result.error} Nothing was changed.`,
      })
    }
    await markFinalized(dir)
  }
  await prunePre(dir, now)
  await rm(path.join(dir, "work"), { recursive: true, force: true })
  await rm(path.join(dir, "incoming"), { recursive: true, force: true })
}

/** Exits so Docker's restart policy starts a fresh process that applies the staged restore. */
export function restartToFinish(): { restarting: boolean } {
  if (process.env.HOMECENTER_SUPERVISED !== "1") return { restarting: false }
  setTimeout(() => process.exit(0), 750).unref()
  return { restarting: true }
}
```

In `instrumentation.ts`, before the notification scheduler starts (finalize must run before `markInterruptedRuns`):
```ts
  try {
    const { finalizeRestore } = await import("@/lib/backup/restore-server")
    await finalizeRestore()
  } catch (e) {
    console.error("[restore] finalize failed:", e)
  }
```

- [ ] **Step 4: Write `scripts/restore.ts`**

```ts
// npm run restore -- <file> [--dry-run] [--key kit.txt | --passphrase-env VAR] [--yes]
// For when the app won't start. Stop HomeCenter first.
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { appMigrations, dbPathFromUrl, restoreDir, searchIndexFile, uploadDir } from "../lib/backup/paths"
import { applyPending, cancelRestore, dryRun, stage } from "../lib/backup/restore"
import { unlockArgs } from "../lib/backup/protect"

async function main() {
  const args = process.argv.slice(2)
  const file = args[0]
  if (!file) throw new Error("Usage: npm run restore -- <file> [--dry-run] [--key kit.txt | --passphrase-env VAR] [--yes]")
  const paths = { dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), restoreDir: restoreDir(), searchIndexPath: searchIndexFile() }
  const { mkdir } = await import("node:fs/promises")
  await mkdir(paths.restoreDir, { recursive: true })
  const d = await dryRun({ archivePath: path.resolve(file), secret: await unlockArgs(args), paths, known: await appMigrations() })
  if (!d.ok) throw new Error(d.needs ? `${d.error} Use --key <kit file> or --passphrase-env <VAR>.` : d.error)

  console.log(`Backup from ${d.manifest.createdAt} (HomeCenter ${d.manifest.appVersion})`)
  for (const k of Object.keys(d.backupCounts)) if (d.backupCounts[k] || d.currentCounts[k]) console.log(`  ${k.padEnd(20)} now ${String(d.currentCounts[k]).padStart(6)}  →  backup ${d.backupCounts[k]}`)
  console.log(`Secrets: ${d.secrets}`)
  for (const w of d.warnings) console.warn(`Warning: ${w}`)
  if (args.includes("--dry-run")) {
    await cancelRestore(paths.restoreDir)
    console.log("Dry run only: nothing changed.")
    return
  }
  if (!args.includes("--yes")) {
    console.log("\nThis REPLACES everything in this HomeCenter. Stop HomeCenter before continuing.")
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question("Type RESTORE to continue: ")
    rl.close()
    if (answer.trim() !== "RESTORE") {
      await cancelRestore(paths.restoreDir)
      console.log("Cancelled.")
      return
    }
  }
  await stage({ paths })
  const r = await applyPending(paths)
  if (!r.applied || r.result.status !== "ok") throw new Error(r.applied ? `${r.result.error} (rolled back)` : "Nothing was staged.")
  console.log("Restored. Start HomeCenter: it upgrades the database if needed and signs everyone out.")
}

main().catch((e) => {
  console.error(`Restore failed: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
```

- [ ] **Step 5: CLI check on scratch only**

Run (Bash, scratch env vars; app on :3133 stopped):
1. `npm run restore -- <scratch>/cli-backups/<file> --dry-run` → counts table, "Dry run only".
2. `npm run restore -- <file> --yes` → "Restored." Then start the scratch server: logs show no restore errors; bell shows "Restored from the backup of …"; old session is signed out.

- [ ] **Step 6: Checks and commit**

Run: `npm test; npx tsc --noEmit; npm run lint`
```bash
git add scripts/restore-apply.ts scripts/restore.ts lib/backup/restore-server.ts lib/backup/protect.ts docker-entrypoint.sh package.json instrumentation.ts
git commit -m "Apply staged restores at boot, finalize after migrations, add restore CLI"
```

---

### Task 13: Restore UI, upload route, fresh-install entry

**Files:**
- Create: `app/api/backup/upload/route.ts`, `components/settings/data/restore-panel.tsx`, `components/dashboard/fresh-start-card.tsx`
- Modify: `proxy.ts` (matcher), `lib/actions/backup.ts`, `lib/backup/overview-server.ts` (`RestoreState`), `components/settings/data/data-settings.tsx`, `components/settings/data/backup-list.tsx` (Restore button wired), `app/(app)/page.tsx`

**Interfaces:**
- Consumes: Tasks 11–12
- Produces:
  - `type RestoreState = { result: RestoreResult | null; undoAvailableUntil: string | null; pending: boolean }`
  - Actions: `restoreDryRun(input: { source: { upload: string } | { file: string }; key?: string; password?: string }): Promise<DryRun>`, `restoreConfirm(input: { word: string }): Promise<{ ok: true } | { error: string }>`, `restoreRestart(): Promise<{ restarting: boolean }>`, `restoreUndo(): Promise<{ ok: true } | { error: string }>`, `restoreCancel(): Promise<void>`
  - Route: `POST /api/backup/upload` → `{ id: string }`

- [ ] **Step 1: Exclude the upload route from the proxy**

`proxy.ts` matcher: add `api/backup/upload$` next to `api/uploads$`:
```ts
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/|api/uploads$|api/backup/upload$|api/assets/[^/]+/[^/]+/image$).*)"],
```

- [ ] **Step 2: Write `app/api/backup/upload/route.ts`**

```ts
import { createWriteStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { NextRequest, NextResponse } from "next/server"
import { adminSession } from "@/lib/auth-guard"
import { restoreDir } from "@/lib/backup/paths"

// Excluded from proxy.ts so a multi-GB body isn't capped; auth is checked here.
export async function POST(request: NextRequest) {
  if (!(await adminSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!request.body) return NextResponse.json({ error: "No file" }, { status: 400 })
  const dir = path.join(restoreDir(), "incoming")
  await rm(dir, { recursive: true, force: true }) // one upload at a time
  await mkdir(dir, { recursive: true })
  const id = randomUUID()
  const dest = path.join(dir, `${id}.upload`)
  try {
    await pipeline(Readable.fromWeb(request.body as never), createWriteStream(dest))
  } catch {
    await rm(dest, { force: true })
    return NextResponse.json({ error: "The upload didn't finish." }, { status: 400 })
  }
  return NextResponse.json({ id })
}
```

- [ ] **Step 3: Add restore actions to `lib/actions/backup.ts`**

```ts
import { appMigrations } from "@/lib/backup/paths"
import { cancelRestore, dryRun, stage, stageUndo, type DryRun } from "@/lib/backup/restore"
import { restartToFinish, restorePaths } from "@/lib/backup/restore-server"
import { isJobRunning } from "@/lib/backup/jobs-server"

const UPLOAD_ID = /^[0-9a-f-]{36}$/

export async function restoreDryRun(input: { source: { upload: string } | { file: string }; key?: string; password?: string }): Promise<DryRun> {
  await requireAdmin()
  if (isJobRunning()) return { ok: false, error: "Wait for the running backup or export to finish." }
  const paths = restorePaths()
  let archivePath: string
  if ("upload" in input.source) {
    if (!UPLOAD_ID.test(input.source.upload)) return { ok: false, error: "Upload not found." }
    archivePath = path.join(paths.restoreDir, "incoming", `${input.source.upload}.upload`)
  } else {
    const file = input.source.file
    const b = (await listBackups(backupFolder(await loadBackupSettings()))).find((x) => x.file === file)
    if (!b) return { ok: false, error: "That backup isn't in the backup folder any more." }
    archivePath = b.path
  }
  const { mkdir } = await import("node:fs/promises")
  await mkdir(paths.restoreDir, { recursive: true })
  return dryRun({ archivePath, secret: { key: input.key, password: input.password }, paths, known: await appMigrations() })
}

export async function restoreConfirm(input: { word: string }): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  if (input.word.trim() !== "RESTORE") return { error: "Type RESTORE to confirm." }
  try {
    await stage({ paths: restorePaths() })
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't prepare the restore." }
  }
  return { ok: true }
}

export async function restoreRestart(): Promise<{ restarting: boolean }> {
  await requireAdmin()
  return restartToFinish()
}

export async function restoreUndo(): Promise<{ ok: true } | { error: string }> {
  await requireAdmin()
  try {
    await stageUndo({ paths: restorePaths() })
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't prepare the undo." }
  }
  return { ok: true }
}

export async function restoreCancel(): Promise<void> {
  await requireAdmin()
  await cancelRestore(restorePaths().restoreDir)
}
```

- [ ] **Step 4: Widen `RestoreState` in `lib/backup/overview-server.ts`**

```ts
import { hasPending, latestPre, readResult, type RestoreResult } from "./restore"
import { restoreDir } from "./paths"

export type RestoreState = { result: RestoreResult | null; undoAvailableUntil: string | null; pending: boolean }

// inside loadBackupOverview, add to the Promise.all and the return value:
//   readResult(restoreDir()), latestPre(restoreDir()), hasPending(restoreDir())
//   restore: { result, undoAvailableUntil: pre ? new Date(new Date(pre.createdAt).getTime() + 7 * 86_400_000).toISOString() : null, pending }
```

- [ ] **Step 5: Write `components/settings/data/restore-panel.tsx`**

```tsx
"use client"

import { useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Upload, RotateCcw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { restoreCancel, restoreConfirm, restoreDryRun, restoreRestart, restoreUndo } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import type { DryRun } from "@/lib/backup/restore"
import { formatWhen } from "./format"

export type RestoreSource = { upload: string } | { file: string }

const LABELS: Record<string, string> = {
  Property: "Properties", Vehicle: "Vehicles", Equipment: "Equipment", Person: "People", ServiceRecord: "Service records",
  Warranty: "Warranties", MaintenanceSchedule: "Reminders", Attachment: "Files", User: "Accounts", InsurancePolicy: "Insurance policies",
  Medication: "Medications", HealthCondition: "Conditions", Observation: "Observations", Allergy: "Allergies", Immunization: "Immunizations",
  Provider: "Providers", InboxItem: "Intake items",
}
const SECRETS: Record<string, string> = {
  carried: "The mail password and AI key come with this backup.",
  "same-secret": "The mail password and AI key will work (same AUTH_SECRET).",
  "re-enter": "You'll need to re-enter the mail password and AI key afterwards.",
  none: "",
}

export function RestorePanel({ data, source, setSource }: { data: BackupOverview; source: RestoreSource | null; setSource: (s: RestoreSource | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const r = data.restore

  function upload(file: File) {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/backup/upload")
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      setProgress(null)
      if (xhr.status !== 200) return void toast.error("The upload didn't finish.")
      setSource({ upload: (JSON.parse(xhr.responseText) as { id: string }).id })
    }
    xhr.onerror = () => {
      setProgress(null)
      toast.error("The upload didn't finish.")
    }
    xhr.send(file)
  }

  return (
    <Card className="py-5" id="restore">
      <CardHeader className="px-5">
        <CardTitle>Restore</CardTitle>
        <CardDescription>Replaces everything in HomeCenter with a backup. You'll see what changes before anything happens.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        {r?.result && !r.pending && (
          <p className={r.result.status === "ok" ? "text-sm" : "text-sm text-destructive"}>
            {r.result.status === "ok"
              ? `${r.result.source === "undo" ? "Undid the restore" : `Restored from the backup of ${r.result.backupCreatedAt ? formatWhen(r.result.backupCreatedAt) : "?"}`} on ${formatWhen(r.result.appliedAt)}.`
              : `The last restore didn't finish: ${r.result.error} Nothing was changed.`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" className="hidden" accept=".hcbackup,.age,.zip" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {progress !== null ? `Uploading… ${progress}%` : "Restore from a file"}
          </Button>
          {r?.undoAvailableUntil && (
            <Button variant="ghost" disabled={pending} onClick={() => start(async () => {
              if (!window.confirm("Go back to how HomeCenter was just before the last restore?")) return
              const res = await restoreUndo()
              if ("error" in res) return void toast.error(res.error)
              await finish()
            })}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />Undo last restore
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Or use Restore on a backup in the list above.</p>
      </CardContent>
      {source && <RestoreDialog source={source} onClose={() => { void restoreCancel(); setSource(null) }} />}
    </Card>
  )
}

async function finish() {
  const { restarting } = await restoreRestart()
  if (!restarting) {
    toast.info("Restart HomeCenter to finish the restore.", { duration: Infinity })
    return
  }
  toast.loading("Restarting HomeCenter…", { duration: Infinity })
  // Wait for the old process to go, then for the new one to answer.
  await new Promise((r) => setTimeout(r, 2000))
  for (;;) {
    try {
      if ((await fetch("/api/health", { cache: "no-store" })).ok) break
    } catch {
      // still restarting
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  window.location.href = "/login"
}

function RestoreDialog({ source, onClose }: { source: RestoreSource; onClose: () => void }) {
  const [report, setReport] = useState<DryRun | null>(null)
  const [key, setKey] = useState("")
  const [password, setPassword] = useState("")
  const [word, setWord] = useState("")
  const [pending, start] = useTransition()

  function check() {
    start(async () => setReport(await restoreDryRun({ source, key: key || undefined, password: password || undefined })))
  }
  // First check as soon as the dialog opens; Unlock re-runs it with the key or password.
  const first = useRef(false)
  useEffect(() => {
    if (first.current) return
    first.current = true
    check()
  })

  const needs = report && !report.ok ? report.needs : undefined
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Restore a backup</DialogTitle>
          <DialogDescription>Checking the backup before anything changes.</DialogDescription>
        </DialogHeader>

        {pending && <p className="text-sm text-muted-foreground">Checking…</p>}

        {report && !report.ok && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{report.error}</p>
            {needs === "key" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-key">Recovery key (paste it, or choose the kit file)</Label>
                <Textarea id="rs-key" rows={3} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AGE-SECRET-KEY-1…" />
                <Input type="file" accept=".txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setKey(await f.text()) }} />
              </div>
            )}
            {needs === "password" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-pw">Password</Label>
                <Input id="rs-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {report?.ok && (
          <div className="space-y-3 text-sm">
            <p>Backup from <strong>{formatWhen(report.manifest.createdAt)}</strong> (HomeCenter {report.manifest.appVersion}).</p>
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground"><th className="text-left font-normal">What</th><th className="text-right font-normal">Now</th><th className="text-right font-normal">After restore</th></tr></thead>
              <tbody>
                {Object.keys(LABELS).filter((k) => report.backupCounts[k] || report.currentCounts[k]).map((k) => (
                  <tr key={k}><td>{LABELS[k]}</td><td className="text-right tabular-nums">{report.currentCounts[k] ?? 0}</td><td className="text-right tabular-nums">{report.backupCounts[k] ?? 0}</td></tr>
                ))}
              </tbody>
            </table>
            {SECRETS[report.secrets] && <p className="text-xs">{SECRETS[report.secrets]}</p>}
            {report.warnings.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{report.warnings.length} file(s) were already missing when this backup was made.</p>}
            <p className="rounded-md border border-destructive/40 p-2 text-xs">
              Everything now in HomeCenter is replaced. Everyone is signed out, and sign-ins become the accounts in this backup.
              You can undo this for 7 days.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="rs-word">Type RESTORE to continue</Label>
              <Input id="rs-word" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
          {needs && <Button disabled={pending || (needs === "key" ? !key : !password)} onClick={check}>Unlock</Button>}
          {report?.ok && (
            <Button variant="destructive" disabled={pending || word.trim() !== "RESTORE"} onClick={() => start(async () => {
              const r = await restoreConfirm({ word })
              if ("error" in r) return void toast.error(r.error)
              await finish()
            })}>
              Restore and restart
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```
Add `useEffect` to the file's `react` import (`useEffect, useRef, useState, useTransition`).

`DataSettings`: hold `const [restoreSource, setRestoreSource] = useState<RestoreSource | null>(null)`, pass `onRestore={(b) => setRestoreSource({ file: b.file })}` to `BackupList`, and render `<RestorePanel data={data} source={restoreSource} setSource={setRestoreSource} />` last.

- [ ] **Step 6: Fresh-install entry on the dashboard**

`components/dashboard/fresh-start-card.tsx`:
```tsx
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"

/** Shown to admins while HomeCenter holds no assets or records. */
export function FreshStartCard() {
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Welcome to HomeCenter</CardTitle>
        <CardDescription>Start fresh, or bring everything over from a backup of another HomeCenter.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 px-5">
        <Link href="/assets/properties" className={buttonVariants()}>Add your first asset</Link>
        <Link href="/settings?tab=data#restore" className={buttonVariants({ variant: "outline" })}>Restore from a backup</Link>
      </CardContent>
    </Card>
  )
}
```
`app/(app)/page.tsx`: add `prisma.person.count()` (unfiltered, as `personTotal`) and `prisma.serviceRecord.count()` (as `recordTotal`) to the `Promise.all`; compute `const empty = propertyCount + vehicleCount + equipmentCount + personTotal + recordTotal === 0`; render `{empty && session?.user.role === "ADMIN" && <FreshStartCard />}` directly under the welcome heading.

- [ ] **Step 7: Checks and browser pass**

Run: `npm test; npx tsc --noEmit; npm run lint`.
Scratch server with `HOMECENTER_SUPERVISED` **unset** (Playwright can't rely on a supervisor), on two scratch households A (seeded) and B (empty, admin only):
1. In A: Back up now (password protection) → Download the file.
2. Start B's scratch server: dashboard shows "Welcome to HomeCenter" with "Restore from a backup" → Data tab → Restore from a file → upload progress → dialog asks for password → wrong password shows "That password doesn't open this backup." → right one shows the table (Now 0 → After N) and "come with this backup" → button disabled until `RESTORE` typed → click → toast "Restart HomeCenter to finish".
3. Stop B's server, run `npx tsx scripts/restore-apply.ts` with B's scratch env (the scratch server is started with `npx next start`, which skips `prestart`), then start it again: login page; sign in with A's admin; data present; bell "Restored from the backup of …"; Settings → Mail shows a stored password (not "unreadable").
4. Undo last restore → restart → B is empty again.
5. Upload an export zip (after Slice 4) or any random zip → dialog shows the refusal text, nothing staged.
6. Phone width + dark: dialog and table fit.

- [ ] **Step 8: Commit**

```bash
git add proxy.ts app/api/backup/upload lib/actions/backup.ts lib/backup/overview-server.ts components/settings/data components/dashboard/fresh-start-card.tsx "app/(app)/page.tsx"
git commit -m "Add in-app restore with dry run, confirmation, restart and undo"
```

---

# Slice 4 — Export and offline viewer

### Task 14: Readable data and scopes

**Files:**
- Create: `lib/backup/readable.ts`
- Test: `lib/backup/readable.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 3), `ExportScope` (Task 1)
- Produces:
  - `type FileRef = { name: string; path: string; size: number; mimeType: string }` (`path` relative to `readable/index.html`)
  - `type PublicAsset = { id: string; type: "property" | "vehicle" | "equipment" | "person"; name: string; details: Record<string, string | number | null>; photo: string | null; propertyId: string | null }`
  - `type ReadableData = { formatVersion: 1; generatedAt: string; scope: ExportScope; assets: PublicAsset[]; serviceRecords: PublicRecord[]; warranties: PublicWarranty[]; reminders: PublicReminder[]; documents: PublicDocument[]; health: PublicHealth | null }` (field lists in the code below)
  - `type PlannedFile = { rel: string; archivePath: string }` (upload-relative source → path inside the archive)
  - `loadReadable(snapshot: string, scope: ExportScope, place: (f: { rel: string; asset: PublicAsset | null; section: string; originalName: string }) => string): Promise<{ data: ReadableData; files: PlannedFile[] }>`
  - `rawPlacement: place function for backups` → `files/<rel>`; `exportPlacement(): place function` → `files/<Type>/<asset name>/<section>/<originalName>` (flattened, numbered on collision)
  - `toCsv(rows: Record<string, unknown>[], columns: string[]): string`
  - `csvTables(data: ReadableData): Record<string, string>` (file name → CSV)

- [ ] **Step 1: Write the failing test `lib/backup/readable.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { createMigratedDb, seedSample, tempDir } from "./test-support"
import { csvTables, exportPlacement, loadReadable, rawPlacement, toCsv } from "./readable"

async function snap() {
  const dir = await tempDir()
  const db = path.join(dir, "x.db")
  await createMigratedDb(db)
  await seedSample(db, path.join(dir, "uploads"))
  return db
}

describe("readable", () => {
  it("everything: assets, records with file links, health", async () => {
    const { data, files } = await loadReadable(await snap(), { kind: "all", includeHealth: true }, rawPlacement)
    expect(data.assets.map((a) => a.name).sort()).toEqual(["Daily Driver", "Main House", "Pat"])
    const oil = data.serviceRecords.find((r) => r.title === "Oil change")!
    expect(oil).toMatchObject({ assetId: "v1", cost: 49.5 })
    expect(oil.files[0]).toMatchObject({ name: "receipt.pdf", path: "../files/service/s1/f-a1.pdf" })
    expect(data.health?.medications.map((m) => m.name)).toEqual(["Ibuprofen"])
    expect(files.map((f) => f.rel).sort()).toEqual(["properties/p1/img-p1.jpg", "service/s1/f-a1.pdf", "service/s2/f-a2.pdf"])
  })

  it("excluding health drops people, their records and their files", async () => {
    const { data, files } = await loadReadable(await snap(), { kind: "all", includeHealth: false }, rawPlacement)
    expect(data.assets.some((a) => a.type === "person")).toBe(false)
    expect(data.serviceRecords.map((r) => r.title)).toEqual(["Oil change"])
    expect(data.health).toBeNull()
    expect(files.map((f) => f.rel)).not.toContain("service/s2/f-a2.pdf")
  })

  it("one asset", async () => {
    const { data } = await loadReadable(await snap(), { kind: "asset", assetType: "VEHICLE", assetId: "v1" }, rawPlacement)
    expect(data.assets.map((a) => a.id)).toEqual(["v1"])
    expect(data.serviceRecords).toHaveLength(1)
  })

  it("export paths are flattened and never escape", () => {
    const place = exportPlacement()
    const asset = { id: "v1", type: "vehicle" as const, name: "../../Daily/Driver", details: {}, photo: null, propertyId: null }
    expect(place({ rel: "x", asset, section: "service", originalName: "../../etc/passwd" })).toBe("files/Vehicles/.._.._Daily_Driver/service/.._.._etc_passwd")
    expect(place({ rel: "y", asset, section: "service", originalName: "../../etc/passwd" })).toBe("files/Vehicles/.._.._Daily_Driver/service/.._.._etc_passwd (2)")
    expect(place({ rel: "z", asset: null, section: "insurance", originalName: "CON" })).toBe("files/Other/insurance/CON")
  })

  it("csv quotes, escapes and starts with a BOM", () => {
    const csv = toCsv([{ a: 'say "hi"', b: "x,y", c: null }], ["a", "b", "c"])
    expect(csv).toBe('\uFEFFa,b,c\r\n"say ""hi""","x,y",\r\n')
  })

  it("builds the csv set", async () => {
    const { data } = await loadReadable(await snap(), { kind: "all", includeHealth: true }, rawPlacement)
    expect(Object.keys(csvTables(data)).sort()).toEqual(
      ["allergies.csv", "assets.csv", "conditions.csv", "documents.csv", "immunizations.csv", "insurance.csv", "medications.csv", "observations.csv", "providers.csv", "reminders.csv", "service-records.csv", "warranties.csv"])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/backup/readable.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `lib/backup/readable.ts`**

```ts
// Engine file: relative imports and npm packages only.
// The public, documented shape of an export (docs/export-format.md). Read with
// plain SQL from a snapshot so it never depends on the Prisma client's shape.
import type { Client, Row } from "@libsql/client"
import { attachmentDir, type AttachmentLocation } from "../attachment-location"
import type { ExportScope } from "./format"
import { openDb } from "./snapshot"

export type FileRef = { name: string; path: string; size: number; mimeType: string }
type AssetType = "property" | "vehicle" | "equipment" | "person"
export type PublicAsset = { id: string; type: AssetType; name: string; details: Record<string, string | number | null>; photo: string | null; propertyId: string | null }
type Owned = { assetId: string; assetType: AssetType }
export type PublicRecord = Owned & { id: string; date: string | null; title: string; vendor: string | null; cost: number | null; category: string | null; mileage: number | null; notes: string | null; files: FileRef[] }
export type PublicWarranty = Owned & { id: string; product: string; purchased: string | null; expires: string | null; vendor: string | null; phone: string | null; email: string | null; notes: string | null; files: FileRef[] }
export type PublicReminder = Owned & { id: string; title: string; everyDays: number | null; everyMiles: number | null; lastDone: string | null; nextDue: string | null; nextDueMileage: number | null; active: boolean; files: FileRef[] }
export type PublicDocument = Owned & FileRef & { id: string; uploaded: string | null }
type PersonOwned = { id: string; personId: string; files: FileRef[] }
export type PublicHealth = {
  providers: { id: string; name: string; specialty: string | null; practice: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null }[]
  conditions: (PersonOwned & { name: string; status: string; diagnosed: string | null; resolved: string | null; notes: string | null })[]
  medications: (PersonOwned & { name: string; dosage: string | null; frequency: string | null; pharmacy: string | null; start: string | null; end: string | null; nextRefill: string | null; notes: string | null })[]
  allergies: (PersonOwned & { substance: string; reaction: string | null; severity: string; notes: string | null })[]
  immunizations: (PersonOwned & { vaccine: string; given: string | null; dose: string | null; givenBy: string | null; nextDue: string | null; notes: string | null })[]
  observations: (PersonOwned & { date: string | null; time: string | null; type: string; severity: number | null; minutes: number | null; tags: string | null; notes: string | null })[]
  insurance: { id: string; personIds: string[]; carrier: string; plan: string | null; kind: string; policyNumber: string | null; groupNumber: string | null; memberId: string | null; phone: string | null; start: string | null; end: string | null; notes: string | null; files: FileRef[] }[]
}
export type ReadableData = {
  formatVersion: 1; generatedAt: string; scope: ExportScope
  assets: PublicAsset[]; serviceRecords: PublicRecord[]; warranties: PublicWarranty[]; reminders: PublicReminder[]; documents: PublicDocument[]
  health: PublicHealth | null
}
export type PlannedFile = { rel: string; archivePath: string }
export type Place = (f: { rel: string; asset: PublicAsset | null; section: string; originalName: string }) => string

/** Prisma stores DateTime in SQLite as ms since epoch or ISO text depending on the path that wrote it; accept both. */
function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  const d = typeof v === "number" || typeof v === "bigint" ? new Date(Number(v)) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))
const TYPE: Record<string, AssetType> = { PROPERTY: "property", VEHICLE: "vehicle", EQUIPMENT: "equipment", PERSON: "person" }

export const rawPlacement: Place = ({ rel }) => `files/${rel}`

const TYPE_DIR: Record<AssetType, string> = { property: "Properties", vehicle: "Vehicles", equipment: "Equipment", person: "People" }
/** Readable paths for exports, as the per-asset zip used: flattened names, numbered duplicates. */
export function exportPlacement(): Place {
  const used = new Set<string>()
  const flat = (s: string) => s.replace(/[\\/]/g, "_").replace(/^\.+$/, "_") || "_"
  return ({ asset, section, originalName }) => {
    const base = asset ? `files/${TYPE_DIR[asset.type]}/${flat(asset.name)}/${section}/${flat(originalName)}` : `files/Other/${section}/${flat(originalName)}`
    let p = base
    for (let n = 2; used.has(p); n++) p = `${base} (${n})`
    used.add(p)
    return p
  }
}

async function all(c: Client, sql: string): Promise<Row[]> {
  try {
    return (await c.execute(sql)).rows
  } catch {
    return [] // table missing in an older schema
  }
}

export async function loadReadable(snapshot: string, scope: ExportScope, place: Place): Promise<{ data: ReadableData; files: PlannedFile[] }> {
  const c = openDb(snapshot)
  try {
    const includeHealth = scope.kind === "all" ? scope.includeHealth : scope.assetType === "PERSON"
    const [props, vehicles, equipment, people] = await Promise.all([
      all(c, `SELECT * FROM "Property"`), all(c, `SELECT * FROM "Vehicle"`), all(c, `SELECT * FROM "Equipment"`), includeHealth ? all(c, `SELECT * FROM "Person"`) : Promise.resolve([] as Row[]),
    ])
    let assets: PublicAsset[] = [
      ...props.map((r) => ({ id: String(r.id), type: "property" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Type: str(r.type), Address: str(r.address), "Year built": num(r.yearBuilt), "Square feet": num(r.sqFt), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...vehicles.map((r) => ({ id: String(r.id), type: "vehicle" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Make: str(r.make), Model: str(r.model), Year: num(r.year), VIN: str(r.vin), Color: str(r.color), "Current reading": num(r.currentMileage), Unit: str(r.meterUnit), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...equipment.map((r) => ({ id: String(r.id), type: "equipment" as const, name: String(r.name), propertyId: str(r.propertyId), photo: str(r.imageFilename),
        details: { Category: str(r.category), Manufacturer: str(r.manufacturer), Model: str(r.modelNumber), Serial: str(r.serialNumber), Location: str(r.location), Installed: iso(r.installDate), Purchased: iso(r.purchaseDate), "Purchase price": num(r.purchasePrice), Notes: str(r.notes) } })),
      ...people.map((r) => ({ id: String(r.id), type: "person" as const, name: String(r.name), propertyId: null, photo: str(r.imageFilename),
        details: { Relationship: str(r.relationship), Born: iso(r.dateOfBirth), Sex: str(r.sex), "Blood type": str(r.bloodType), Notes: str(r.notes) } })),
    ]
    if (scope.kind === "asset") {
      const keep = new Set([scope.assetId])
      if (scope.assetType === "PROPERTY") for (const e of assets) if (e.type === "equipment" && e.propertyId === scope.assetId) keep.add(e.id)
      assets = assets.filter((a) => keep.has(a.id))
    }
    const byId = new Map(assets.map((a) => [a.id, a]))
    const ownedOk = (r: Row) => byId.has(String(r.assetId)) && (includeHealth || r.assetType !== "PERSON")

    const files: PlannedFile[] = []
    const attachments = await all(c, `SELECT * FROM "Attachment"`)
    const fileFor = (a: Row, asset: PublicAsset | null, section: string): FileRef | null => {
      const dir = attachmentDir(a as unknown as AttachmentLocation)
      if (!dir) return null
      const rel = `${dir[0]}/${dir[1]}/${String(a.filename)}`
      const archivePath = place({ rel, asset, section, originalName: String(a.originalName) })
      files.push({ rel, archivePath })
      return { name: String(a.originalName), path: `../${archivePath}`, size: Number(a.sizeBytes), mimeType: String(a.mimeType) }
    }
    const attachedTo = (col: string, id: unknown, asset: PublicAsset | null, section: string) =>
      attachments.filter((a) => a[col] === id).map((a) => fileFor(a, asset, section)).filter((f): f is FileRef => !!f)

    for (const a of assets) {
      if (a.photo) {
        const dir = { property: "properties", vehicle: "vehicles", equipment: "equipment", person: "people" }[a.type]
        const rel = `${dir}/${a.id}/${a.photo}`
        const archivePath = place({ rel, asset: a, section: "photo", originalName: a.photo })
        files.push({ rel, archivePath })
        a.photo = `../${archivePath}`
      }
    }

    const owner = (r: Row) => ({ assetId: String(r.assetId), assetType: TYPE[String(r.assetType)] })
    const serviceRecords = (await all(c, `SELECT * FROM "ServiceRecord" ORDER BY date DESC`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), date: iso(r.date), title: String(r.title), vendor: str(r.vendor), cost: num(r.cost), category: str(r.category),
      mileage: num(r.mileageAtService), notes: str(r.description), files: attachedTo("serviceRecordId", r.id, byId.get(String(r.assetId)) ?? null, "service"),
    }))
    const warranties = (await all(c, `SELECT * FROM "Warranty"`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), product: String(r.productName), purchased: iso(r.purchaseDate), expires: iso(r.expirationDate), vendor: str(r.vendor),
      phone: str(r.vendorPhone), email: str(r.vendorEmail), notes: str(r.notes), files: attachedTo("warrantyId", r.id, byId.get(String(r.assetId)) ?? null, "warranties"),
    }))
    const reminders = (await all(c, `SELECT * FROM "MaintenanceSchedule"`)).filter(ownedOk).map((r) => ({
      ...owner(r), id: String(r.id), title: String(r.title), everyDays: num(r.intervalDays), everyMiles: num(r.intervalMiles), lastDone: iso(r.lastCompletedDate),
      nextDue: iso(r.nextDueDate), nextDueMileage: num(r.nextDueMileage), active: Boolean(Number(r.isActive)),
      files: attachedTo("maintenanceScheduleId", r.id, byId.get(String(r.assetId)) ?? null, "reminders"),
    }))
    const documents = attachments.filter((a) => a.recordType === "DOCUMENT" && ownedOk(a)).map((a) => {
      const asset = byId.get(String(a.assetId)) ?? null
      return { ...owner(a), id: String(a.id), uploaded: iso(a.uploadedAt), ...fileFor(a, asset, "documents")! }
    })

    let health: PublicHealth | null = null
    if (includeHealth) {
      const personIds = new Set(assets.filter((a) => a.type === "person").map((a) => a.id))
      const mine = (r: Row) => personIds.has(String(r.personId))
      const person = (r: Row) => byId.get(String(r.personId)) ?? null
      const members = await all(c, `SELECT * FROM "_InsurancePolicyToPerson"`)
      const providers = scope.kind === "all" ? await all(c, `SELECT * FROM "Provider"`) : []
      health = {
        providers: providers.map((r) => ({ id: String(r.id), name: String(r.name), specialty: str(r.specialty), practice: str(r.practice), phone: str(r.phone), email: str(r.email), address: str(r.address), notes: str(r.notes) })),
        conditions: (await all(c, `SELECT * FROM "HealthCondition"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), name: String(r.name), status: String(r.status), diagnosed: iso(r.diagnosedDate), resolved: iso(r.resolvedDate), notes: str(r.notes), files: attachedTo("healthConditionId", r.id, person(r), "conditions") })),
        medications: (await all(c, `SELECT * FROM "Medication"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), name: String(r.name), dosage: str(r.dosage), frequency: str(r.frequency), pharmacy: str(r.pharmacy), start: iso(r.startDate), end: iso(r.endDate), nextRefill: iso(r.nextRefillDate), notes: str(r.notes), files: attachedTo("medicationId", r.id, person(r), "medications") })),
        allergies: (await all(c, `SELECT * FROM "Allergy"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), substance: String(r.substance), reaction: str(r.reaction), severity: String(r.severity), notes: str(r.notes), files: attachedTo("allergyId", r.id, person(r), "allergies") })),
        immunizations: (await all(c, `SELECT * FROM "Immunization"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), vaccine: String(r.vaccine), given: iso(r.dateGiven), dose: str(r.dose), givenBy: str(r.givenBy), nextDue: iso(r.nextDueDate), notes: str(r.notes), files: attachedTo("immunizationId", r.id, person(r), "immunizations") })),
        observations: (await all(c, `SELECT * FROM "Observation"`)).filter(mine).map((r) => ({ id: String(r.id), personId: String(r.personId), date: iso(r.date), time: str(r.time), type: String(r.type), severity: num(r.severity), minutes: num(r.durationMinutes), tags: str(r.tags), notes: str(r.notes), files: attachedTo("observationId", r.id, person(r), "observations") })),
        insurance: (await all(c, `SELECT * FROM "InsurancePolicy"`))
          .map((r) => ({ r, ids: members.filter((m) => m.A === r.id).map((m) => String(m.B)).filter((id) => personIds.has(id)) }))
          .filter(({ ids }) => ids.length > 0 || scope.kind === "all")
          .map(({ r, ids }) => ({ id: String(r.id), personIds: ids, carrier: String(r.carrier), plan: str(r.planName), kind: String(r.kind), policyNumber: str(r.policyNumber), groupNumber: str(r.groupNumber), memberId: str(r.memberId), phone: str(r.phone), start: iso(r.startDate), end: iso(r.endDate), notes: str(r.notes), files: attachedTo("insurancePolicyId", r.id, byId.get(ids[0]) ?? null, "insurance") })),
      }
    }

    return {
      data: { formatVersion: 1, generatedAt: new Date().toISOString(), scope, assets, serviceRecords, warranties, reminders, documents, health },
      files,
    }
  } finally {
    c.close()
  }
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\uFEFF" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n"
}

export function csvTables(d: ReadableData): Record<string, string> {
  const name = new Map(d.assets.map((a) => [a.id, a.name]))
  const withAsset = <T extends { assetId: string }>(rows: T[]) => rows.map((r) => ({ ...r, asset: name.get(r.assetId) ?? r.assetId }))
  const withPerson = <T extends { personId: string }>(rows: T[]) => rows.map((r) => ({ ...r, person: name.get(r.personId) ?? r.personId }))
  const out: Record<string, string> = {
    "assets.csv": toCsv(d.assets.map((a) => ({ id: a.id, type: a.type, name: a.name, ...a.details })), ["id", "type", "name", ...new Set(d.assets.flatMap((a) => Object.keys(a.details)))]),
    "service-records.csv": toCsv(withAsset(d.serviceRecords), ["date", "asset", "assetType", "title", "vendor", "cost", "category", "mileage", "notes", "id"]),
    "warranties.csv": toCsv(withAsset(d.warranties), ["asset", "product", "purchased", "expires", "vendor", "phone", "email", "notes", "id"]),
    "reminders.csv": toCsv(withAsset(d.reminders), ["asset", "title", "everyDays", "everyMiles", "lastDone", "nextDue", "nextDueMileage", "active", "id"]),
    "documents.csv": toCsv(withAsset(d.documents), ["asset", "name", "uploaded", "size", "mimeType", "path", "id"]),
  }
  if (d.health) {
    out["providers.csv"] = toCsv(d.health.providers, ["name", "specialty", "practice", "phone", "email", "address", "notes", "id"])
    out["conditions.csv"] = toCsv(withPerson(d.health.conditions), ["person", "name", "status", "diagnosed", "resolved", "notes", "id"])
    out["medications.csv"] = toCsv(withPerson(d.health.medications), ["person", "name", "dosage", "frequency", "pharmacy", "start", "end", "nextRefill", "notes", "id"])
    out["allergies.csv"] = toCsv(withPerson(d.health.allergies), ["person", "substance", "reaction", "severity", "notes", "id"])
    out["immunizations.csv"] = toCsv(withPerson(d.health.immunizations), ["person", "vaccine", "given", "dose", "givenBy", "nextDue", "notes", "id"])
    out["observations.csv"] = toCsv(withPerson(d.health.observations), ["person", "date", "time", "type", "severity", "minutes", "tags", "notes", "id"])
    out["insurance.csv"] = toCsv(d.health.insurance.map((p) => ({ ...p, people: p.personIds.map((id) => name.get(id) ?? id).join("; ") })), ["people", "carrier", "plan", "kind", "policyNumber", "groupNumber", "memberId", "phone", "start", "end", "notes", "id"])
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/backup/readable.test.ts` → PASS. If the implicit m2m table's column names differ, read them from the migration SQL (`grep -n "_InsurancePolicyToPerson" prisma/migrations/*/migration.sql`).

- [ ] **Step 5: Commit**

```bash
git add lib/backup/readable.ts lib/backup/readable.test.ts
git commit -m "Add the public readable data shape, scopes and CSV tables"
```

---

### Task 15: Offline viewer, readable layer in backups, export engine

**Files:**
- Create: `lib/backup/viewer.ts`, `lib/backup/export.ts`
- Modify: `lib/backup/jobs-server.ts` (pass `readable` to `createBackup`), `scripts/backup.ts` (same)
- Test: `lib/backup/viewer.test.ts`, `lib/backup/export.test.ts`

**Interfaces:**
- Consumes: Task 14; `ArchiveWriter`, `createBackup`, `protectFile`, `verifyArchive`
- Produces:
  - `viewerHtml(): string`, `dataJs(data: ReadableData): string`
  - `writeReadableLayer(w: ArchiveWriter, data: ReadableData): Promise<void>` (index.html, data.js, data/*.json, csv/*.csv under `readable/`)
  - `backupReadable(snapshot: string, w: ArchiveWriter): Promise<void>` (the `readable` hook for backups: all + health, raw placement, files already present)
  - `type ExportInput = { dbPath; uploadDir; outDir; workDir; appVersion: string; scope: ExportScope; password?: string | null; now?: Date; onProgress?: (d: number, t: number) => void }`, `createExport(i): Promise<{ path: string; file: string; warnings: string[] }>`

- [ ] **Step 1: Write the failing tests**

`lib/backup/viewer.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { dataJs, viewerHtml } from "./viewer"

describe("offline viewer", () => {
  it("loads nothing from the network", () => {
    const html = viewerHtml()
    expect(html).toContain('<script src="data.js"></script>')
    expect(html).not.toMatch(/(src|href)=["']https?:/)
    expect(html).not.toMatch(/@import|url\(http/)
  })
  it("data.js cannot break out of its script", () => {
    const js = dataJs({ assets: [{ name: "</script><script>alert(1)</script>" }] } as never)
    expect(js.startsWith("window.HC_DATA = ")).toBe(true)
    expect(js).not.toContain("</script>")
  })
  it("renders data with textContent only", () => {
    expect(viewerHtml()).not.toContain("innerHTML")
  })
})
```

`lib/backup/export.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import path from "node:path"
import { createExport } from "./export"
import { createBackup } from "./backup"
import { backupReadable } from "./viewer"
import { ArchiveReader } from "./archive"
import { verifyArchive } from "./verify"
import { createMigratedDb, seedSample, tempDir } from "./test-support"

async function setup() {
  const dir = await tempDir()
  const dbPath = path.join(dir, "homecenter.db")
  const uploadDir = path.join(dir, "uploads")
  await createMigratedDb(dbPath)
  await seedSample(dbPath, uploadDir)
  return { dir, dbPath, uploadDir, workDir: path.join(dir, "work") }
}

describe("exports", () => {
  it("everything without health: readable files, no database, refuses restore", async () => {
    const s = await setup()
    const out = await createExport({ ...s, outDir: path.join(s.dir, "out"), appVersion: "t", scope: { kind: "all", includeHealth: false }, now: new Date(2026, 9, 11, 9, 30) })
    expect(out.file).toBe("homecenter-export-2026-10-11-0930.zip")
    const r = await ArchiveReader.open(out.path)
    const names = r.entries()
    expect(names).not.toContain("db/homecenter.db")
    expect(names).toContain("readable/index.html")
    expect(names).toContain("readable/csv/service-records.csv")
    expect(names).toContain("files/Vehicles/Daily Driver/service/receipt.pdf")
    expect(names.some((n) => n.includes("visit.pdf"))).toBe(false)
    expect(names).not.toContain("readable/csv/medications.csv")
    const m = await r.manifest()
    await r.close()
    expect(m).toMatchObject({ kind: "export", scope: { kind: "all", includeHealth: false }, hasReadable: true })
    expect((await verifyArchive(out.path, { workDir: s.workDir })).ok).toBe(true)
  })

  it("password export double-wraps", async () => {
    const s = await setup()
    const out = await createExport({ ...s, outDir: path.join(s.dir, "out"), appVersion: "t", scope: { kind: "all", includeHealth: true }, password: "abcdef" })
    const r = await ArchiveReader.open(out.path)
    expect(r.entries()).toEqual([out.file.replace(/\.zip$/, "-inner.zip")])
    await r.close()
  })

  it("backups carry the readable layer pointing at their own files", async () => {
    const s = await setup()
    const b = await createBackup({ ...s, folder: path.join(s.dir, "b"), appVersion: "t", protection: { mode: "none" }, readable: backupReadable })
    const r = await ArchiveReader.open(b.path)
    const js = await r.readText("readable/data.js")
    expect(js).toContain('"../files/service/s1/f-a1.pdf"')
    expect((await r.manifest()).hasReadable).toBe(true)
    await r.close()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/backup/viewer.test.ts lib/backup/export.test.ts` → FAIL (no modules).

- [ ] **Step 3: Implement `lib/backup/viewer.ts`**

```ts
// Engine file: relative imports and npm packages only.
// A single offline page: no network, no framework, DOM built with textContent
// so names and notes from the data can never become markup.
import type { ArchiveWriter } from "./archive"
import { READABLE_PREFIX } from "./format"
import { csvTables, loadReadable, rawPlacement, type ReadableData } from "./readable"

export function dataJs(data: ReadableData): string {
  return `window.HC_DATA = ${JSON.stringify(data).replace(/</g, "\\u003c")};\n`
}

export async function writeReadableLayer(w: ArchiveWriter, data: ReadableData): Promise<void> {
  await w.addBytes(`${READABLE_PREFIX}index.html`, viewerHtml())
  await w.addBytes(`${READABLE_PREFIX}data.js`, dataJs(data))
  const json: Record<string, unknown> = {
    "assets.json": data.assets, "service-records.json": data.serviceRecords, "warranties.json": data.warranties,
    "reminders.json": data.reminders, "documents.json": data.documents, ...(data.health ? { "health.json": data.health } : {}),
  }
  for (const [n, v] of Object.entries(json)) await w.addBytes(`${READABLE_PREFIX}data/${n}`, JSON.stringify(v, null, 2))
  for (const [n, csv] of Object.entries(csvTables(data))) await w.addBytes(`${READABLE_PREFIX}csv/${n}`, csv)
}

/** createBackup's readable hook: everything, linked to the files already stored under files/<rel>. */
export async function backupReadable(snapshot: string, w: ArchiveWriter): Promise<void> {
  const { data } = await loadReadable(snapshot, { kind: "all", includeHealth: true }, rawPlacement)
  await writeReadableLayer(w, data)
}

export function viewerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HomeCenter export</title>
<style>
:root { --bg:#fbfaf8; --fg:#1f1d1a; --muted:#6b665e; --line:#e6e1d9; --card:#fff; --accent:#b4532a; }
@media (prefers-color-scheme: dark) { :root { --bg:#151412; --fg:#ece8e1; --muted:#a39d93; --line:#2c2a26; --card:#1d1b18; --accent:#e08a5f; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
header { padding:16px; border-bottom:1px solid var(--line); display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
header h1 { margin:0; font-size:18px; }
input[type=search] { flex:1; min-width:180px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--fg); }
main { max-width:960px; margin:0 auto; padding:16px; }
a { color:var(--accent); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px; }
.card img { width:100%; height:120px; object-fit:cover; border-radius:6px; }
.muted { color:var(--muted); font-size:13px; }
h2 { font-size:16px; margin:24px 0 8px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 12px; margin:0; }
dt { color:var(--muted); }
@media print { header input, .back { display:none; } body { background:#fff; color:#000; } }
</style>
</head>
<body>
<header><h1>HomeCenter</h1><input type="search" id="q" placeholder="Search everything" aria-label="Search"><span class="muted" id="when"></span></header>
<main id="app"></main>
<script src="data.js"></script>
<script>
(function () {
  var D = window.HC_DATA, app = document.getElementById("app");
  if (!D) { app.textContent = "data.js is missing next to this page."; return; }
  document.getElementById("when").textContent = "Exported " + new Date(D.generatedAt).toLocaleString();
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function day(s) { return s ? new Date(s).toLocaleDateString() : ""; }
  function money(v) { return v == null ? "" : "$" + Number(v).toFixed(2); }
  function files(list) { return el("span", {}, (list || []).map(function (f) { return el("a", { href: f.path, text: f.name, style: "margin-right:8px" }); })); }
  function table(cols, rows) {
    return el("table", {}, [el("thead", {}, [el("tr", {}, cols.map(function (c) { return el("th", { text: c[0] }); }))]),
      el("tbody", {}, rows.map(function (r) { return el("tr", {}, cols.map(function (c) { var v = c[1](r); return v instanceof Node ? el("td", {}, [v]) : el("td", { text: v == null ? "" : String(v) }); })); }))]);
  }
  var LABEL = { property: "Properties", vehicle: "Vehicles", equipment: "Equipment", person: "People" };
  function home(filter) {
    app.replaceChildren();
    var f = (filter || "").toLowerCase();
    ["property", "vehicle", "equipment", "person"].forEach(function (t) {
      var list = D.assets.filter(function (a) { return a.type === t && (!f || JSON.stringify(a).toLowerCase().indexOf(f) >= 0 || related(a).toLowerCase().indexOf(f) >= 0); });
      if (!list.length) return;
      app.appendChild(el("h2", { text: LABEL[t] + " (" + list.length + ")" }));
      app.appendChild(el("div", { class: "grid" }, list.map(function (a) {
        var link = el("a", { href: "#" + a.id, text: a.name });
        return el("div", { class: "card" }, [a.photo ? el("img", { src: a.photo, alt: "" }) : null, el("div", {}, [link]),
          el("div", { class: "muted", text: D.serviceRecords.filter(function (r) { return r.assetId === a.id; }).length + " records" })]);
      })));
    });
  }
  function related(a) {
    return JSON.stringify([D.serviceRecords, D.warranties, D.reminders, D.documents].map(function (l) { return l.filter(function (r) { return r.assetId === a.id; }); }));
  }
  function asset(id) {
    var a = D.assets.find(function (x) { return x.id === id; });
    if (!a) return home();
    app.replaceChildren();
    app.appendChild(el("p", { class: "back" }, [el("a", { href: "#", text: "← All" })]));
    app.appendChild(el("h2", { text: a.name }));
    if (a.photo) app.appendChild(el("img", { src: a.photo, alt: "", style: "max-width:320px;border-radius:8px" }));
    var dl = el("dl");
    Object.keys(a.details).forEach(function (k) { var v = a.details[k]; if (v == null || v === "") return; dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: /T\\d\\d:/.test(String(v)) ? day(v) : String(v) })); });
    app.appendChild(dl);
    var mine = function (l) { return l.filter(function (r) { return r.assetId === a.id; }); };
    var sr = mine(D.serviceRecords);
    if (sr.length) { app.appendChild(el("h2", { text: "History" })); app.appendChild(table([["Date", function (r) { return day(r.date); }], ["What", function (r) { return r.title; }], ["Vendor", function (r) { return r.vendor; }], ["Cost", function (r) { return money(r.cost); }], ["Notes", function (r) { return r.notes; }], ["Files", function (r) { return files(r.files); }]], sr)); }
    var rem = mine(D.reminders);
    if (rem.length) { app.appendChild(el("h2", { text: "Reminders" })); app.appendChild(table([["What", function (r) { return r.title; }], ["Last done", function (r) { return day(r.lastDone); }], ["Next due", function (r) { return day(r.nextDue) + (r.nextDueMileage ? " / " + r.nextDueMileage : ""); }], ["Files", function (r) { return files(r.files); }]], rem)); }
    var w = mine(D.warranties);
    if (w.length) { app.appendChild(el("h2", { text: "Warranties" })); app.appendChild(table([["Product", function (r) { return r.product; }], ["Expires", function (r) { return day(r.expires); }], ["Vendor", function (r) { return r.vendor; }], ["Files", function (r) { return files(r.files); }]], w)); }
    var docs = mine(D.documents);
    if (docs.length) { app.appendChild(el("h2", { text: "Documents" })); app.appendChild(table([["Name", function (r) { return el("a", { href: r.path, text: r.name }); }], ["Added", function (r) { return day(r.uploaded); }]], docs)); }
    if (a.type === "person" && D.health) {
      var H = D.health, p = function (l) { return l.filter(function (r) { return r.personId === a.id; }); };
      [["Conditions", p(H.conditions), [["Name", function (r) { return r.name; }], ["Status", function (r) { return r.status; }], ["Diagnosed", function (r) { return day(r.diagnosed); }], ["Files", function (r) { return files(r.files); }]]],
       ["Medications", p(H.medications), [["Name", function (r) { return r.name; }], ["Dosage", function (r) { return r.dosage; }], ["Frequency", function (r) { return r.frequency; }], ["Files", function (r) { return files(r.files); }]]],
       ["Allergies", p(H.allergies), [["Substance", function (r) { return r.substance; }], ["Reaction", function (r) { return r.reaction; }], ["Severity", function (r) { return r.severity; }]]],
       ["Immunizations", p(H.immunizations), [["Vaccine", function (r) { return r.vaccine; }], ["Given", function (r) { return day(r.given); }], ["Next due", function (r) { return day(r.nextDue); }]]],
       ["Observations", p(H.observations), [["Date", function (r) { return day(r.date); }], ["Type", function (r) { return r.type; }], ["Severity", function (r) { return r.severity; }], ["Notes", function (r) { return r.notes; }]]]
      ].forEach(function (s) { if (s[1].length) { app.appendChild(el("h2", { text: s[0] })); app.appendChild(table(s[2], s[1])); } });
    }
    window.scrollTo(0, 0);
  }
  function route() { var id = location.hash.slice(1); if (id) asset(id); else home(document.getElementById("q").value); }
  document.getElementById("q").addEventListener("input", function (e) { location.hash = ""; home(e.target.value); });
  window.addEventListener("hashchange", route);
  route();
})();
</script>
</body>
</html>
`
}
```

- [ ] **Step 4: Implement `lib/backup/export.ts`**

```ts
// Engine file: relative imports and npm packages only.
import path from "node:path"
import { randomUUID } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
import { ArchiveWriter } from "./archive"
import { archiveName, FORMAT_VERSION, type ExportScope } from "./format"
import { safeJoin } from "./paths"
import { protectFile } from "./protect"
import { exportPlacement, loadReadable } from "./readable"
import { vacuumInto } from "./snapshot"
import { verifyArchive } from "./verify"
import { writeReadableLayer } from "./viewer"

export type ExportInput = {
  dbPath: string; uploadDir: string; outDir: string; workDir: string; appVersion: string; scope: ExportScope
  password?: string | null; now?: Date; onProgress?: (done: number, total: number) => void
}

const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false)

export async function createExport(i: ExportInput): Promise<{ path: string; file: string; warnings: string[] }> {
  const now = i.now ?? new Date()
  await mkdir(i.outDir, { recursive: true })
  await mkdir(i.workDir, { recursive: true })
  const tag = randomUUID().slice(0, 8)
  const snap = path.join(i.workDir, `export-${tag}.db`)
  const file = archiveName("export", now, i.password ? "password" : "none")
  const finalPath = path.join(i.outDir, file)
  const plainPath = i.password ? path.join(i.workDir, `${tag}-export.zip`) : finalPath
  let writer: ArchiveWriter | null = null
  try {
    await vacuumInto(i.dbPath, snap)
    const { data, files } = await loadReadable(snap, i.scope, exportPlacement())
    const warnings: string[] = []
    writer = await ArchiveWriter.create(plainPath)
    let done = 0
    for (const f of files) {
      const src = safeJoin(i.uploadDir, f.rel)
      if (src && (await isFile(src))) await writer.addFile(f.archivePath, src)
      else warnings.push(`Missing file: ${f.rel}`)
      i.onProgress?.(++done, files.length)
    }
    await writeReadableLayer(writer, data)
    const counts = {
      assets: data.assets.length, serviceRecords: data.serviceRecords.length, warranties: data.warranties.length,
      reminders: data.reminders.length, documents: data.documents.length, files: files.length,
    }
    await writer.finish({
      formatVersion: FORMAT_VERSION, kind: "export", scope: i.scope, appVersion: i.appVersion, migration: null,
      createdAt: now.toISOString(), protection: i.password ? "password" : "none", counts, warnings, hasReadable: true, hasSecrets: false,
    })
    writer = null
    const v = await verifyArchive(plainPath, { workDir: i.workDir })
    if (!v.ok) throw new Error(`The export failed verification: ${v.error}`)
    if (i.password) await protectFile(plainPath, finalPath, { mode: "password", password: i.password }, file)
    return { path: finalPath, file, warnings }
  } catch (e) {
    await writer?.abort()
    await rm(finalPath, { force: true })
    throw e
  } finally {
    await rm(snap, { force: true })
    if (i.password) await rm(plainPath, { force: true })
  }
}
```
`protectFile`'s inner name comes from `innerName(file)`, which gives `homecenter-export-…-inner.zip` for exports (Task 1).

- [ ] **Step 5: Turn the readable layer on for backups**

In `lib/backup/jobs-server.ts` `runBackupJob` and in `scripts/backup.ts`, pass `readable: backupReadable` (import from `./viewer` / `../lib/backup/viewer`) to `createBackup`.

- [ ] **Step 6: Run tests, commit**

Run: `npm test; npx tsc --noEmit`
```bash
git add lib/backup/viewer.ts lib/backup/export.ts lib/backup/viewer.test.ts lib/backup/export.test.ts lib/backup/jobs-server.ts scripts/backup.ts
git commit -m "Add the offline viewer, readable layer in backups, and export engine"
```

---

### Task 16: Export UI, per-asset download on the builder, format docs

**Files:**
- Create: `app/api/backup/export/[runId]/route.ts`, `components/settings/data/export-panel.tsx`, `docs/export-format.md`
- Modify: `lib/backup/jobs-server.ts` (`startExportJob`), `lib/actions/backup.ts` (`startExport`, `exportStatus`), `lib/backup/overview-server.ts` (asset list for the scope picker), `components/settings/data/data-settings.tsx`, `app/api/assets/[type]/[id]/download/route.ts`, `lib/backup/restore-server.ts` (clean old exports at boot)

**Interfaces:**
- Consumes: `createExport` (Task 15)
- Produces:
  - `startExportJob(input: { scope: ExportScope; password: string | null; userId: string }): Promise<{ runId: string } | { error: string }>` (writes to `<workDir>/exports/<runId>/`)
  - Actions: `startExport(input: { scope: "all" | { assetType: AssetKind; assetId: string }; includeHealth: boolean; password: string }): Promise<{ runId: string } | { error: string }>`, `exportStatus(runId: string): Promise<{ status: string; done: number; total: number; error: string | null }>`
  - Route: `GET /api/backup/export/[runId]` streams the file and deletes it after
  - `BackupOverview.assets: { type: AssetKind; id: string; name: string }[]`

- [ ] **Step 1: Add `startExportJob` to `lib/backup/jobs-server.ts`**

```ts
import path from "node:path"
import { createExport } from "./export"
import type { ExportScope } from "./format"

export const exportDir = (runId: string) => path.join(workDir(), "exports", runId)

export async function startExportJob(input: { scope: ExportScope; password: string | null; userId: string }): Promise<{ runId: string } | { error: string }> {
  if (running) return { error: "A backup or export is already running." }
  const run = await prisma.backupRun.create({
    data: { kind: "EXPORT", trigger: "MANUAL", protection: input.password ? "PASSWORD" : "NONE", createdById: input.userId },
  })
  running = run.id
  void (async () => {
    try {
      const out = await createExport({
        dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), outDir: exportDir(run.id), workDir: workDir(),
        appVersion: await appVersion(), scope: input.scope, password: input.password,
        onProgress: (done, total) => void prisma.backupRun.update({ where: { id: run.id }, data: { progressDone: done, progressTotal: total } }).catch(() => {}),
      })
      await prisma.backupRun.update({ where: { id: run.id }, data: { status: out.warnings.length ? "WARN" : "OK", finishedAt: new Date(), file: out.file, warnings: JSON.stringify(out.warnings) } })
    } catch (e) {
      await prisma.backupRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: e instanceof Error ? e.message : String(e) } })
    } finally {
      running = null
    }
  })()
  return { runId: run.id }
}
```

- [ ] **Step 2: Add the actions**

```ts
import { startExportJob } from "@/lib/backup/jobs-server"
import { passwordProblem } from "@/lib/backup/protect-shared"
import { loadFeatures } from "@/lib/features-server"
import type { AssetKind, ExportScope } from "@/lib/backup/format"

export async function startExport(input: { scope: "all" | { assetType: AssetKind; assetId: string }; includeHealth: boolean; password: string }) {
  const session = await requireAdmin()
  if (input.password && passwordProblem(input.password)) return { error: passwordProblem(input.password)! }
  const health = (await loadFeatures()).health
  if (input.scope !== "all" && input.scope.assetType === "PERSON" && !health) return { error: "Health is turned off." }
  // With Health off it stays out of exports too.
  const scope: ExportScope = input.scope === "all" ? { kind: "all", includeHealth: health && input.includeHealth } : { kind: "asset", ...input.scope }
  return startExportJob({ scope, password: input.password || null, userId: session.user.id })
}

export async function exportStatus(runId: string) {
  await requireAdmin()
  const r = await prisma.backupRun.findUnique({ where: { id: runId } })
  if (!r || r.kind !== "EXPORT") return { status: "FAILED", done: 0, total: 0, error: "Export not found." }
  return { status: r.status, done: r.progressDone, total: r.progressTotal, error: r.error }
}
```

- [ ] **Step 3: Export download route `app/api/backup/export/[runId]/route.ts`**

```ts
import { createReadStream } from "node:fs"
import { rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { adminSession } from "@/lib/auth-guard"
import { exportDir } from "@/lib/backup/jobs-server"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  if (!(await adminSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { runId } = await params
  const run = await prisma.backupRun.findUnique({ where: { id: runId } })
  if (!run || run.kind !== "EXPORT" || !run.file || (run.status !== "OK" && run.status !== "WARN")) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const dir = exportDir(run.id)
  const p = path.join(dir, run.file)
  const size = await stat(p).then((s) => s.size, () => null)
  if (size === null) return NextResponse.json({ error: "This export was already downloaded." }, { status: 410 })
  const stream = createReadStream(p)
  // One download per export: the file holds everything, so it doesn't linger on disk.
  stream.on("close", () => void rm(dir, { recursive: true, force: true }))
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: { "Content-Type": "application/zip", "Content-Length": String(size), "Content-Disposition": `attachment; filename="${run.file}"` },
  })
}
```
In `finalizeRestore` (runs every boot), also `rm(path.join(workDir(), "exports"), { recursive: true, force: true })`: exports never survive a restart.

- [ ] **Step 4: Asset list for the scope picker**

In `loadBackupOverview`, add `assets` (properties, vehicles, equipment, and people only when Health is on) as `{ type, id, name }[]` sorted by type then name, using `prisma.property.findMany({ select: { id: true, name: true } })` etc.; add the field to `BackupOverview`.

- [ ] **Step 5: `components/settings/data/export-panel.tsx`**

```tsx
"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { FileDown, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { exportStatus, startExport } from "@/lib/actions/backup"
import { passwordProblem } from "@/lib/backup/protect-shared"
import type { BackupOverview } from "@/lib/backup/overview-server"

export function ExportPanel({ data }: { data: BackupOverview }) {
  const [scope, setScope] = useState("all")
  const [includeHealth, setIncludeHealth] = useState(false)
  const [protect, setProtect] = useState(false)
  const [pw, setPw] = useState("")
  const [again, setAgain] = useState("")
  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!runId) return
    const t = setInterval(async () => {
      const s = await exportStatus(runId)
      setProgress({ done: s.done, total: s.total })
      if (s.status === "OK" || s.status === "WARN") {
        clearInterval(t)
        setRunId(null)
        setProgress(null)
        window.location.href = `/api/backup/export/${runId}`
        toast.success("Export ready. It downloads once and isn't kept on the server.")
      } else if (s.status === "FAILED") {
        clearInterval(t)
        setRunId(null)
        setProgress(null)
        toast.error(s.error ?? "The export didn't finish.")
      }
    }, 1000)
    return () => clearInterval(t)
  }, [runId])

  const pwProblem = protect && pw ? passwordProblem(pw) : null
  const blocked = protect && (!pw || !!pwProblem || pw !== again)

  function go() {
    start(async () => {
      const [type, id] = scope.split(":")
      const r = await startExport({
        scope: scope === "all" ? "all" : { assetType: type as "PROPERTY", assetId: id },
        includeHealth, password: protect ? pw : "",
      })
      if ("error" in r) return void toast.error(r.error)
      setRunId(r.runId)
    })
  }

  const select = "h-9 w-full rounded-md border bg-background px-2 text-sm"
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Export</CardTitle>
        <CardDescription>
          A zip you can open on any computer: an offline page to browse everything, spreadsheets (CSV), and every file in readable folders. Exports can&apos;t be restored; use a backup for that.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ex-scope">What</Label>
          <select id="ex-scope" className={select} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Everything</option>
            {data.assets.map((a) => <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>{a.name}</option>)}
          </select>
        </div>
        {scope === "all" && data.healthEnabled && (
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={includeHealth} onChange={(e) => setIncludeHealth(e.target.checked)} />
            Include health records
          </label>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
          Protect with a password (send the password separately from the file)
        </label>
        {protect && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ex-pw">Password</Label>
              <Input id="ex-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              {pwProblem && <p className="text-xs text-destructive">{pwProblem}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-pw2">Same password again</Label>
              <Input id="ex-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
              {again && pw !== again && <p className="text-xs text-destructive">The passwords don&apos;t match.</p>}
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <Button onClick={go} disabled={pending || !!runId || blocked}>
            {runId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
            {runId ? (progress?.total ? `Exporting… ${progress.done} of ${progress.total} files` : "Exporting…") : "Create export"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```
Add `<ExportPanel data={data} />` to `DataSettings` after `BackupList`.

- [ ] **Step 6: Per-asset "Download files" on the builder**

Replace the body of `app/api/assets/[type]/[id]/download/route.ts` after the existing auth/type/health checks with:
```ts
  const run = `asset-${randomUUID()}`
  const outDir = path.join(workDir(), "exports", run)
  try {
    const out = await createExport({
      dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), outDir, workDir: workDir(),
      appVersion: await appVersion(), scope: { kind: "asset", assetType, assetId: id },
    })
    const stream = createReadStream(out.path)
    stream.on("close", () => void rm(outDir, { recursive: true, force: true }))
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="homecenter-${type}-${id}.zip"` },
    })
  } catch (e) {
    await rm(outDir, { recursive: true, force: true })
    console.error("[download] export failed:", e)
    return NextResponse.json({ error: "Couldn't build the download." }, { status: 500 })
  }
```
Remove the now-unused `fflate`, `collectAssetFiles` and `uniquePath` code from this route. Keep `lib/asset-files-server.ts` only if something else imports it (`grep -rn collectAssetFiles app lib components`); delete it otherwise. This route stays available to every signed-in user, as before.

- [ ] **Step 7: `docs/export-format.md`**

Write the contract: archive layout (from the spec's "Archive layout"), `manifest.json` fields with types (copy `Manifest` from `lib/backup/format.ts`), sidecar fields, the public JSON entities (copy the `Public*` types from `lib/backup/readable.ts` with one line per field), CSV files and columns (from `csvTables`), protection formats (age v1 X25519; AES-256 zip containing one inner archive), and the compatibility rule (`formatVersion` increments on breaking changes; readers must ignore unknown fields).

- [ ] **Step 8: Checks and browser pass**

Run: `npm test; npx tsc --noEmit; npm run lint`.
Scratch server, Playwright:
1. Export Everything (health off by default) → download `homecenter-export-….zip`; unzip in the scratch dir; open `readable/index.html` with `file://` in Playwright: asset cards render, an asset page shows history with working file links, search filters, no console errors, no network requests (assert via `page.on("request")` only `file:` URLs).
2. Export with "Include health records" → People appear; without → no People section.
3. Password export: wrong password fails in zip.js; right one shows a single `-inner.zip` entry.
4. Second click on the same download URL → 410.
5. Asset page "Download files" (vehicle) → zip contains `readable/index.html` and `files/Vehicles/<name>/service/...`.
6. Viewer in dark mode and at 390 px: no horizontal scroll.

- [ ] **Step 9: Commit**

```bash
git add -A app/api/backup/export lib/backup/jobs-server.ts lib/actions/backup.ts lib/backup/overview-server.ts lib/backup/restore-server.ts components/settings/data "app/api/assets/[type]/[id]/download/route.ts" docs/export-format.md lib/asset-files-server.ts
git commit -m "Add export with offline viewer and move asset downloads onto it"
```
(`-A` on `lib/asset-files-server.ts` records its deletion if Step 6 removed it.)

---

### Task 17: Final verification and docs

**Files:**
- Modify: `docs/product-discovery/prioritized-roadmap.md` (M4 status), `docs/product-discovery/current-state-assessment.md` (no-export/no-backup gaps), `README.md` feature table line "Records & export"

- [ ] **Step 1: Full suite**

Run: `npm ci; npm test; npx tsc --noEmit; npm run lint`
Expected: all tests pass; tsc clean; lint shows only the 16 pre-existing problems.

- [ ] **Step 2: End-to-end on scratch**

One continuous Playwright run on a fresh scratch household: set Recovery key → Back up now → download kit and backup → delete a record → Restore that backup with the kit (restart scratch server) → record is back → Undo → record gone again → Export everything → viewer opens offline.

- [ ] **Step 3: Docker build smoke test (if Docker is available locally)**

Run: `docker build -t homecenter:backup-test .` then `docker run --rm -e DATABASE_URL=file:/data/homecenter.db -e AUTH_SECRET=test -v <scratch>/docker-data:/data homecenter:backup-test npx tsx scripts/restore-apply.ts` → exits 0 with no output (nothing pending), proving the engine files resolve inside the runner. Skip with a note if Docker isn't available.

- [ ] **Step 4: Update docs**

Roadmap: M4 → "Done (2026-10-xx)", listing backup/schedule/protection/restore/export and commit hashes. Assessment: strike the "No full export" and "No in-app backup or restore" lines with "Fixed". README feature table: "Records & export" now true; link the backup FAQ.

- [ ] **Step 5: Commit**

```bash
git add docs/product-discovery/prioritized-roadmap.md docs/product-discovery/current-state-assessment.md README.md
git commit -m "Record M4 backup, restore and export as done"
```
