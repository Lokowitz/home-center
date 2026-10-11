// The only file types an upload may be stored as. The stored extension and the
// served MIME type both come from this table, never from what the client sent,
// so a file named "x.html" cannot land on disk as HTML.
export const UPLOAD_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".pages": "application/x-iwork-pages-sffpages",
  ".numbers": "application/x-iwork-numbers-sffnumbers",
  ".key": "application/x-iwork-keynote-sffkey",
  ".zip": "application/zip",
  ".msg": "application/vnd.ms-outlook",
  ".eml": "message/rfc822",
  ".md": "text/markdown",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".odg": "application/vnd.oasis.opendocument.graphics",
  ".epub": "application/epub+zip",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".gz": "application/gzip",
}

export function extensionForFilename(name: string): string | null {
  const dot = name.lastIndexOf(".")
  if (dot < 0) return null
  const ext = name.slice(dot).toLowerCase()
  return ext in UPLOAD_TYPES ? ext : null
}

export function mimeForFilename(name: string): string | null {
  const ext = extensionForFilename(name)
  return ext ? UPLOAD_TYPES[ext] : null
}
