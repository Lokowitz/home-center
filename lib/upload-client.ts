import type { Attachment, AttachmentRecordType } from "@/app/generated/prisma/client"

/// Uploads one file to /api/uploads. Throws with the server's message on failure.
export async function uploadFile(file: File, recordType: AttachmentRecordType, recordId: string): Promise<Attachment> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("recordId", recordId)
  formData.append("recordType", recordType)
  const res = await fetch("/api/uploads", { method: "POST", body: formData })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Failed to upload "${file.name}"`)
  return json.attachment
}

/// Uploads every file; resolves to the first failure's message, or null when all succeeded.
export async function uploadAll(files: File[], recordType: AttachmentRecordType, recordId: string): Promise<string | null> {
  const results = await Promise.allSettled(files.map((f) => uploadFile(f, recordType, recordId)))
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected")
  if (!failure) return null
  return failure.reason instanceof Error ? failure.reason.message : "Some files failed to upload."
}
