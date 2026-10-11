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
