# HomeCenter export format

An export is a zip you can open on any computer. You do not need HomeCenter to read it.
Exports are for reading and moving data elsewhere. They cannot be restored. Use a backup for that.

## Layout

```
homecenter-export-YYYY-MM-DD-HHmm.zip
  manifest.json
  readable/
    index.html        open this in a browser, offline
    data.js           the same data, loaded by index.html
    data/*.json       one JSON file per kind of record
    csv/*.csv         one spreadsheet file per kind of record
  files/<Type>/<asset>/<section>/<file>
```

Exports contain no database and no secrets.

`<Type>` is Properties, Vehicles, Equipment or People. Names are made safe for Windows, macOS and Linux.
If two files would share a name, the second becomes `name (2).ext`.

## formatVersion

`formatVersion` is in `manifest.json` and in `data.js`. It is 1 today.
It goes up when a change would break a reader. New fields can appear without a new version.
Readers must ignore fields they do not know.

## manifest.json

| Field | Type | Meaning |
| --- | --- | --- |
| formatVersion | number | See above. |
| kind | "export" | |
| scope | object | `{ "kind": "all", "includeHealth": boolean }` or `{ "kind": "asset", "assetType": "PROPERTY" \| "VEHICLE" \| "EQUIPMENT" \| "PERSON", "assetId": string }` |
| appVersion | string | HomeCenter version that made it. |
| migration | null | Always null in an export. |
| createdAt | string | ISO time. |
| protection | "none" \| "password" | |
| counts | object | Number of assets, serviceRecords, warranties, reminders, documents, rooms and files. |
| files | array | `{ path, size, sha256 }` for every entry except `manifest.json`. |
| warnings | string[] | For example a file that was missing on disk. |
| hasReadable | boolean | True when `readable/` is present. |
| hasSecrets | boolean | Always false in an export. |

## JSON files

Files are in `readable/data/`. All dates are ISO 8601 text. A value that is not set is `null`.
`assetType` is `property`, `vehicle`, `equipment` or `person`.
A file reference (`FileRef`) is `{ name, path, size, mimeType }`. `path` is relative to the zip root, for example `files/Vehicles/Truck/service/receipt.pdf`.

- `assets.json`: `id`, `type`, `name`, `details` (labels and values, such as Make or Address), `photo` (path or null), `propertyId` (for equipment). Equipment details include "Counts as" (Part of the home or Belongings; the category's default when none was picked), "Expected life (years)" and "Replacement cost".
- `service-records.json`: `id`, `assetId`, `assetType`, `date`, `title`, `vendor`, `cost`, `category`, `mileage`, `notes`, `files`.
- `warranties.json`: `id`, `assetId`, `assetType`, `product`, `purchased`, `expires`, `vendor`, `phone`, `email`, `notes`, `files`.
- `reminders.json`: `id`, `assetId`, `assetType`, `title`, `repeats` (for example "Every 90 days", "Apr, Oct" or "Once"), `estimatedCost`, `manual` (file name and page, for example "Owner manual.pdf, p. 42"), `everyDays`, `everyMiles`, `lastDone`, `nextDue`, `nextDueMileage`, `active`, `files`.
- `documents.json`: `id`, `assetId`, `assetType`, `uploaded`, plus the `FileRef` fields.
- `rooms.json`: `id`, `assetId` (the property), `assetType` (always `property`), `name`, `level`, `area` (the number as stored, in the household's area unit), `dimensions`, `flooringType`, `flooringProduct`, `flooringInstalled`, `notes`, `paints` (each `surface`, `brand`, `colorName`, `colorCode`, `finish`), `files`.
- `insurance.json`: home, renters, auto, umbrella, life and other non-health policies, always exported, with or without health records. Each has `id`, `kind`, `carrier`, `plan`, `policyNumber`, `groupNumber`, `memberId`, `phone`, `start`, `end`, `deductible`, `outOfPocketMax`, `notes`, `personIds`, `propertyIds`, `vehicleIds`, `annualPremium` (the current premium as a yearly cost), `premiums` (`effective`, `amount`, `period`, `annual`, `notes`, newest first), `coverages` (`label`, `limit`, `deductible`) and `files`.
- `health.json`: only when health records are included. Holds `providers`, `conditions`, `medications`, `allergies`, `immunizations`, `observations` and `insurance` (medical, dental and vision policies, with the same fields as `insurance.json`). Each item has an `id`, the fields named in its CSV below, and `files`. Items for a person carry `personId`. Insurance carries `personIds`.

## CSV files

Files are in `readable/csv/`. They are UTF-8 with a byte order mark, so Excel opens them correctly. Lines end with CRLF.
The first row holds the column names. `asset` and `person` hold the name instead of the id.

| File | Columns |
| --- | --- |
| assets.csv | id, type, name, then every detail label |
| service-records.csv | date, asset, assetType, title, vendor, cost, category, mileage, notes, id |
| warranties.csv | asset, product, purchased, expires, vendor, phone, email, notes, id |
| reminders.csv | asset, title, repeats, estimatedCost, manual, everyDays, everyMiles, lastDone, nextDue, nextDueMileage, active, id |
| rooms.csv | asset, name, level, area, dimensions, flooringType, flooringProduct, flooringInstalled, notes, id |
| room-paints.csv | asset, room, surface, brand, colorName, colorCode, finish, roomId |
| documents.csv | asset, name, uploaded, size, mimeType, path, id |
| insurance.csv | people, covers, carrier, plan, kind, policyNumber, groupNumber, memberId, phone, start, end, deductible, annualPremium, notes, id |
| insurance-premiums.csv | carrier, effective, amount, period, annual, notes, policyId, id |
| insurance-coverages.csv | carrier, label, limit, deductible, policyId, id |
| providers.csv | name, specialty, practice, phone, email, address, notes, id |
| conditions.csv | person, name, status, diagnosed, resolved, notes, id |
| medications.csv | person, name, dosage, frequency, pharmacy, start, end, nextRefill, notes, id |
| allergies.csv | person, substance, reaction, severity, notes, id |
| immunizations.csv | person, vaccine, given, dose, givenBy, nextDue, notes, id |
| observations.csv | person, date, time, type, severity, minutes, tags, notes, id |

The last six files above appear only when health records are included.

### Formulas in spreadsheets

A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return could run as a formula in Excel or Sheets.
To stop that, such a cell gets a `'` in front. A phone number like `+1 555 0100` appears as `'+1 555 0100`.
Remove the `'` if you need the original text. The JSON files are never changed this way.

## Password protection

A protected export is a `.zip` with AES-256 encryption. It holds one inner zip, `<name>-inner.zip`, so even file names stay hidden.
7-Zip opens it. So do most other tools that support AES zips. Enter the password, then open the inner zip.
The password is at least 6 characters. It is not stored anywhere. If you lose it, the export cannot be opened.

## Backup archive layout

A backup is also a zip, but it is for restoring, not reading. Restore it in Settings → Data or with `npm run restore`.

```
homecenter-YYYY-MM-DD-HHmm.hcbackup
  manifest.json       same fields as above, with kind "backup", scope null and migration set
  db/homecenter.db    a consistent copy of the database (SQLite)
  files/<upload rel>  every uploaded file, at its path inside the upload folder (for example files/service/<id>/<file>)
  readable/           the same offline viewer, JSON and CSVs as an export, covering everything including health
  secrets.json        only in protected backups: { "mailPassword", "llmApiKey" } in plain text inside the protection
```

An unprotected backup never contains `secrets.json`. Restoring one under a different `AUTH_SECRET` means re-entering the mail password, AI key and push URL.

### Protection wrappers

| Protection | File name | What it is |
| --- | --- | --- |
| None | `homecenter-….hcbackup` | The zip above. Any zip tool opens it. |
| Recovery key | `homecenter-….hcbackup.age` | The `.hcbackup` encrypted with [age](https://age-encryption.org) to the recovery key's public half. Only the key file opens it. |
| Password zip | `homecenter-….hcbackup.zip` | An AES-256 zip holding one entry, the `.hcbackup`, so even file names stay hidden. 7-Zip, WinRAR and Keka open it. |

### Sidecar

Next to every backup is `<file>.meta.json`, in plain text. It lets HomeCenter list and check a backup without opening it. It holds no record content.

| Field | Type | Meaning |
| --- | --- | --- |
| sidecarVersion | number | 1 today. |
| file | string | The backup's file name. |
| createdAt | string | ISO time. |
| kind | "backup" | |
| size | number | Bytes of the file as stored (after protection). |
| sha256 | string | Hash of the file as stored. **Check this backup** compares it. |
| appVersion | string | HomeCenter version that made it. |
| migration | string | Latest database migration in the backup. |
| protection | "none" \| "key" \| "password" | |
| keyFingerprint | string \| null | Which recovery key it needs, for key-protected backups. |
| warningCount | number | Files that were missing on disk when it was made. |

HomeCenter lists, prunes and deletes only files that have a valid sidecar. Other files in the folder are left alone.

## Opening a recovery-key backup with age

You don't need HomeCenter to open a key-protected backup. Install [age](https://age-encryption.org) and use the recovery kit file you downloaded as the identity:

```bash
age -d -i homecenter-recovery-key.txt homecenter-2026-01-01-0300.hcbackup.age > homecenter-2026-01-01-0300.hcbackup
```

The result is the plain `.hcbackup` zip described above.

Kit files downloaded before this version have text lines that age doesn't accept. For one of those, put the line that starts with `AGE-SECRET-KEY-1` in a file of its own and pass that file to `-i`.
