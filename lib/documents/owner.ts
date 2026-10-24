import type { AssetType } from "@/app/generated/prisma/client"
import { assetHref } from "@/lib/assets"
import { observationHref } from "@/lib/observations"
import { attachmentDir, type AttachmentLocation } from "@/lib/attachment-location"
import { toDay } from "@/lib/llm/serialize"

// What a file belongs to, for the assistant: the record's kind and title, the
// page to link, the asset or person it hangs off, and the file's own URL
// (served by app/api/files/[...path], the same path the upload route wrote).

type OnAsset = { assetType: AssetType; assetId: string }
type OnPerson = { personId: string }

export type AttachmentOwnerRow = AttachmentLocation & {
  id: string
  filename: string
  originalName: string
  serviceRecord: ({ title: string } & OnAsset) | null
  warranty: ({ productName: string } & OnAsset) | null
  maintenanceSchedule: ({ title: string } & OnAsset) | null
  healthCondition: ({ name: string } & OnPerson) | null
  observation: ({ id: string; type: string; date: Date } & OnPerson) | null
  medication: ({ name: string } & OnPerson) | null
  allergy: ({ substance: string } & OnPerson) | null
  immunization: ({ vaccine: string } & OnPerson) | null
  insurancePolicy: { carrier: string; kind: string } | null
  room: { name: string; propertyId: string } | null
  assetType: AssetType | null
}

export type DocumentRef = {
  attachmentId: string
  fileName: string
  fileHref: string | null
  record: { type: string; title: string; href: string | null }
  asset: { type: AssetType; id: string } | null
  /** Set on an insurance policy's files: health kinds count as health documents. */
  insuranceKind?: string
}

type Owner = Pick<DocumentRef, "record" | "asset">

/** A tab on the owner's page, opening one item where that tab supports ?open= (see the asset pages). */
const tabHref = (base: string, tab: string, openId?: string | null) =>
  `${base}?tab=${tab}${openId ? `&open=${openId}` : ""}`

// Record kinds are named as the UI names them: a person's service records are
// "Visits", maintenance schedules are "Reminders" / "Maintenance Reminders".
const ASSET_TABS = {
  SERVICE: { tab: "service", type: "service record" },
  WARRANTY: { tab: "warranties", type: "warranty" },
  MAINTENANCE: { tab: "maintenance", type: "maintenance reminder" },
} as const
const PERSON_TABS = {
  SERVICE: { tab: "visits", type: "visit" },
  // A person's page has no warranties tab.
  WARRANTY: { tab: null, type: "warranty" },
  MAINTENANCE: { tab: "reminders", type: "reminder" },
} as const

function onAsset(kind: keyof typeof ASSET_TABS, recordId: string | null, title: string, o: OnAsset): Owner {
  const { tab, type } = o.assetType === "PERSON" ? PERSON_TABS[kind] : ASSET_TABS[kind]
  const base = assetHref(o.assetType, o.assetId)
  return {
    record: { type, title, href: tab ? tabHref(base, tab, recordId) : base },
    asset: { type: o.assetType, id: o.assetId },
  }
}
/** The page showing a service record or warranty, opened on it where its tab supports that. */
export function assetRecordHref(kind: "SERVICE" | "WARRANTY", recordId: string, o: OnAsset): string {
  return onAsset(kind, recordId, "", o).record.href ?? assetHref(o.assetType, o.assetId)
}
const onPerson = (type: string, title: string, personId: string, tab: string, openId?: string | null): Owner => ({
  record: { type, title, href: tabHref(assetHref("PERSON", personId), tab, openId) },
  asset: { type: "PERSON", id: personId },
})
const missing = (type: string): Owner => ({ record: { type, title: "(record not found)", href: null }, asset: null })

function owner(a: AttachmentOwnerRow): Owner {
  switch (a.recordType) {
    case "SERVICE":
      return a.serviceRecord ? onAsset("SERVICE", a.serviceRecordId, a.serviceRecord.title, a.serviceRecord) : missing("service record")
    case "WARRANTY":
      return a.warranty ? onAsset("WARRANTY", a.warrantyId, a.warranty.productName, a.warranty) : missing("warranty")
    case "MAINTENANCE":
      return a.maintenanceSchedule
        ? onAsset("MAINTENANCE", a.maintenanceScheduleId, a.maintenanceSchedule.title, a.maintenanceSchedule)
        : missing("maintenance reminder")
    case "CONDITION":
      // The conditions and allergies tabs can't open a single item.
      return a.healthCondition ? onPerson("condition", a.healthCondition.name, a.healthCondition.personId, "conditions") : missing("condition")
    case "OBSERVATION": {
      const o = a.observation
      return o
        ? { record: { type: "observation", title: `${o.type} on ${toDay(o.date)}`, href: observationHref(o.personId, o.id) }, asset: { type: "PERSON", id: o.personId } }
        : missing("observation")
    }
    case "MEDICATION":
      return a.medication ? onPerson("medication", a.medication.name, a.medication.personId, "medications", a.medicationId) : missing("medication")
    case "ALLERGY":
      return a.allergy ? onPerson("allergy", a.allergy.substance, a.allergy.personId, "allergies") : missing("allergy")
    case "IMMUNIZATION":
      return a.immunization ? onPerson("immunization", a.immunization.vaccine, a.immunization.personId, "immunizations", a.immunizationId) : missing("immunization")
    case "DOCUMENT":
      // Filed on the asset itself: the file is its own record.
      return a.assetType && a.assetId
        ? { record: { type: "document", title: a.originalName, href: tabHref(assetHref(a.assetType, a.assetId), "documents") }, asset: { type: a.assetType, id: a.assetId } }
        : missing("document")
    case "INBOX":
      // Not filed yet: the Intake page is where it can be opened and filed.
      return { record: { type: "intake item", title: a.originalName, href: "/intake" }, asset: null }
    case "INSURANCE":
      return a.insurancePolicy
        ? { record: { type: "insurance policy", title: a.insurancePolicy.carrier, href: "/insurance" }, asset: null }
        : missing("insurance policy")
    case "ROOM":
      // A room's files belong to its property; its Rooms tab opens the room.
      return a.room
        ? { record: { type: "room", title: a.room.name, href: tabHref(assetHref("PROPERTY", a.room.propertyId), "rooms", a.roomId) }, asset: { type: "PROPERTY", id: a.room.propertyId } }
        : missing("room")
  }
}

export function describeAttachment(a: AttachmentOwnerRow): DocumentRef {
  const dir = attachmentDir(a)
  return {
    attachmentId: a.id,
    fileName: a.originalName,
    fileHref: dir ? `/api/files/${dir[0]}/${dir[1]}/${a.filename}` : null,
    ...owner(a),
    ...(a.insurancePolicy ? { insuranceKind: a.insurancePolicy.kind } : {}),
  }
}
