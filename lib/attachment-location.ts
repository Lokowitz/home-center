import type { AttachmentRecordType } from "@/app/generated/prisma/client"

export type AttachmentLocation = {
  recordType: AttachmentRecordType
  serviceRecordId: string | null
  warrantyId: string | null
  maintenanceScheduleId: string | null
  healthConditionId: string | null
  insurancePolicyId: string | null
  observationId: string | null
  medicationId: string | null
  allergyId: string | null
  immunizationId: string | null
  assetId: string | null
  inboxItemId: string | null
}

/// Where an attachment's file lives, read from the attachment's own foreign
/// keys. Callers never supply the directory — that is what let a forged
/// recordId reach the filesystem before.
export function attachmentDir(a: AttachmentLocation): [string, string] | null {
  const id =
    a.recordType === "SERVICE" ? a.serviceRecordId
    : a.recordType === "WARRANTY" ? a.warrantyId
    : a.recordType === "MAINTENANCE" ? a.maintenanceScheduleId
    : a.recordType === "CONDITION" ? a.healthConditionId
    : a.recordType === "INSURANCE" ? a.insurancePolicyId
    : a.recordType === "OBSERVATION" ? a.observationId
    : a.recordType === "MEDICATION" ? a.medicationId
    : a.recordType === "ALLERGY" ? a.allergyId
    : a.recordType === "IMMUNIZATION" ? a.immunizationId
    : a.recordType === "DOCUMENT" ? a.assetId
    : a.recordType === "INBOX" ? a.inboxItemId
    : null
  return id ? [a.recordType.toLowerCase(), id] : null
}
