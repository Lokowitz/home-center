// Which extractor reads which upload type. Every key of UPLOAD_TYPES must
// appear in exactly one of the two lists (kinds.test.ts enforces it), so a new
// upload type forces a decision here.

export type ExtractKind = "pdf" | "office" | "doc" | "text" | "rtf" | "image" | "msg" | "eml" | "sheet" | "ppt"

export const EXTRACT_KIND: Record<string, ExtractKind> = {
  ".pdf": "pdf",
  ".docx": "office",
  ".dotx": "office",
  ".odt": "office",
  ".pptx": "office",
  ".odp": "office",
  ".xlsx": "office",
  ".ods": "office",
  ".doc": "doc",
  ".txt": "text",
  ".csv": "text",
  ".md": "text",
  ".eml": "eml",
  ".msg": "msg",
  ".xls": "sheet",
  ".xlsm": "sheet",
  ".ppt": "ppt",
  ".rtf": "rtf",
  ".jpg": "image",
  ".jpeg": "image",
  ".png": "image",
  ".webp": "image",
}

/** Stored and downloadable, but their text isn't extracted in v1. */
export const NOT_EXTRACTED = [".heic", ".heif", ".pages", ".numbers", ".key", ".zip",
  ".odg", ".epub", ".gif", ".bmp", ".tif", ".tiff", ".7z", ".rar", ".gz"]

export function kindFor(ext: string | null): ExtractKind | null {
  return ext ? (EXTRACT_KIND[ext.toLowerCase()] ?? null) : null
}
