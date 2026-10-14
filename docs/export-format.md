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
| counts | object | Number of assets, serviceRecords, warranties, reminders, documents and files. |
| files | array | `{ path, size, sha256 }` for every entry except `manifest.json`. |
| warnings | string[] | For example a file that was missing on disk. |
| hasReadable | boolean | True when `readable/` is present. |
| hasSecrets | boolean | Always false in an export. |

## JSON files

Files are in `readable/data/`. All dates are ISO 8601 text. A value that is not set is `null`.
`assetType` is `property`, `vehicle`, `equipment` or `person`.
A file reference (`FileRef`) is `{ name, path, size, mimeType }`. `path` is relative to the zip root, for example `files/Vehicles/Truck/service/receipt.pdf`.

- `assets.json`: `id`, `type`, `name`, `details` (labels and values, such as Make or Address), `photo` (path or null), `propertyId` (for equipment).
- `service-records.json`: `id`, `assetId`, `assetType`, `date`, `title`, `vendor`, `cost`, `category`, `mileage`, `notes`, `files`.
- `warranties.json`: `id`, `assetId`, `assetType`, `product`, `purchased`, `expires`, `vendor`, `phone`, `email`, `notes`, `files`.
- `reminders.json`: `id`, `assetId`, `assetType`, `title`, `everyDays`, `everyMiles`, `lastDone`, `nextDue`, `nextDueMileage`, `active`, `files`.
- `documents.json`: `id`, `assetId`, `assetType`, `uploaded`, plus the `FileRef` fields.
- `health.json`: only when health records are included. Holds `providers`, `conditions`, `medications`, `allergies`, `immunizations`, `observations` and `insurance`. Each item has an `id`, the fields named in its CSV below, and `files`. Items for a person carry `personId`. Insurance carries `personIds`.

## CSV files

Files are in `readable/csv/`. They are UTF-8 with a byte order mark, so Excel opens them correctly. Lines end with CRLF.
The first row holds the column names. `asset` and `person` hold the name instead of the id.

| File | Columns |
| --- | --- |
| assets.csv | id, type, name, then every detail label |
| service-records.csv | date, asset, assetType, title, vendor, cost, category, mileage, notes, id |
| warranties.csv | asset, product, purchased, expires, vendor, phone, email, notes, id |
| reminders.csv | asset, title, everyDays, everyMiles, lastDone, nextDue, nextDueMileage, active, id |
| documents.csv | asset, name, uploaded, size, mimeType, path, id |
| providers.csv | name, specialty, practice, phone, email, address, notes, id |
| conditions.csv | person, name, status, diagnosed, resolved, notes, id |
| medications.csv | person, name, dosage, frequency, pharmacy, start, end, nextRefill, notes, id |
| allergies.csv | person, substance, reaction, severity, notes, id |
| immunizations.csv | person, vaccine, given, dose, givenBy, nextDue, notes, id |
| observations.csv | person, date, time, type, severity, minutes, tags, notes, id |
| insurance.csv | people, carrier, plan, kind, policyNumber, groupNumber, memberId, phone, start, end, notes, id |

The last seven files appear only when health records are included.

### Formulas in spreadsheets

A text cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return could run as a formula in Excel or Sheets.
To stop that, such a cell gets a `'` in front. A phone number like `+1 555 0100` appears as `'+1 555 0100`.
Remove the `'` if you need the original text. The JSON files are never changed this way.

## Password protection

A protected export is a `.zip` with AES-256 encryption. It holds one inner zip, `<name>-inner.zip`, so even file names stay hidden.
7-Zip opens it. So do most other tools that support AES zips. Enter the password, then open the inner zip.
The password is at least 6 characters. It is not stored anywhere. If you lose it, the export cannot be opened.
