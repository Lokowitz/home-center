// Where a file goes when an attachment is re-filed (e.g. inbox → service record).
// Same layout as resolveUploadPath: <root>/<recordtype lowercase>/<recordId>/<filename>,
// with every segment proven to be a single plain name inside the root.
import path from "path"

export type FileLocation = { recordType: string; recordId: string }
export type MovePlan = { fromPath: string; toPath: string; toDir: string }

function segment(s: string, what: string): string {
  if (!s || s === "." || s === ".." || /[/\\\0]/.test(s)) throw new Error(`Invalid ${what}: ${JSON.stringify(s)}`)
  return s
}

function inside(root: string, ...segments: string[]): string {
  const full = path.resolve(root, ...segments)
  if (!full.startsWith(root + path.sep)) throw new Error("Refusing a path outside the upload directory")
  return full
}

export function planMove(uploadRoot: string, from: FileLocation, to: FileLocation, filename: string): MovePlan {
  const root = path.resolve(uploadRoot)
  const name = segment(filename, "filename")
  const dir = (loc: FileLocation) =>
    inside(root, segment(loc.recordType, "record type").toLowerCase(), segment(loc.recordId, "record id"))
  const toDir = dir(to)
  return { fromPath: inside(dir(from), name), toPath: inside(toDir, name), toDir }
}
