import { AttachmentList } from "@/components/attachments/attachment-list"
import { emptyStateCopy } from "@/lib/intake-ui"
import type { Attachment } from "@/app/generated/prisma/client"

/// The Documents tab on an asset page: files that belong to the asset itself
/// rather than to one of its records — a manual, a title, a deed.
export function AssetDocuments({ assetId, documents, hint }: { assetId: string; documents: Attachment[]; hint: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{hint}</p>
      <div className="rounded-lg border bg-card p-4">
        <AttachmentList recordId={assetId} recordType="DOCUMENT" attachments={documents} label="Documents" emptyText={emptyStateCopy("documents")} />
      </div>
    </div>
  )
}
