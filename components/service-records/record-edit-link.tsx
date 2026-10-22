"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ServiceRecordFormDialog } from "@/components/service-records/service-record-form-dialog"
import { loadRecordForEdit, type RecordFormContext } from "@/lib/actions/service-records"
import type { Attachment, ServiceRecord } from "@/app/generated/prisma/client"

type Loaded = { record: ServiceRecord & { attachments: Attachment[] }; ctx: RecordFormContext }

/** A Records-table cell that opens the record's edit form in place instead of going to the asset's page. */
export function RecordEditLink({ id, children }: { id: string; children: React.ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)

  async function open() {
    if (loading) return
    setLoading(true)
    try {
      const result = await loadRecordForEdit(id)
      if ("error" in result) { toast.error(result.error); return }
      setLoaded(result)
    } finally {
      setLoading(false)
    }
  }

  function onAttachmentDeleted(_recordId: string, attachmentId: string) {
    setLoaded((l) => l && { ...l, record: { ...l.record, attachments: l.record.attachments.filter((a) => a.id !== attachmentId) } })
  }

  return (
    <>
      <button type="button" onClick={open} aria-busy={loading} className="flex items-center gap-2 text-left hover:underline">
        {children}
      </button>
      {loaded && (
        <ServiceRecordFormDialog
          open
          onClose={() => setLoaded(null)}
          assetId={loaded.record.assetId}
          assetType={loaded.record.assetType}
          record={loaded.record}
          attachments={loaded.record.attachments}
          onAttachmentDeleted={onAttachmentDeleted}
          {...loaded.ctx}
        />
      )}
    </>
  )
}
