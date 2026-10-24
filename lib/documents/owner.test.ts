import { describe, expect, it } from "vitest"
import { assetRecordHref, describeAttachment, type AttachmentOwnerRow } from "./owner"

describe("assetRecordHref", () => {
  it("opens the record on its tab, or the person's page where there is no tab", () => {
    expect(assetRecordHref("SERVICE", "s1", { assetType: "VEHICLE", assetId: "v1" })).toBe("/assets/vehicles/v1?tab=service&open=s1")
    expect(assetRecordHref("SERVICE", "s1", { assetType: "PERSON", assetId: "p1" })).toBe("/assets/people/p1?tab=visits&open=s1")
    expect(assetRecordHref("WARRANTY", "w1", { assetType: "EQUIPMENT", assetId: "e1" })).toBe("/assets/equipment/e1?tab=warranties&open=w1")
    expect(assetRecordHref("WARRANTY", "w1", { assetType: "PERSON", assetId: "p1" })).toBe("/assets/people/p1")
  })
})

const none = {
  serviceRecordId: null, warrantyId: null, maintenanceScheduleId: null, healthConditionId: null, insurancePolicyId: null,
  observationId: null, medicationId: null, allergyId: null, immunizationId: null, inboxItemId: null,
  serviceRecord: null, warranty: null, maintenanceSchedule: null, healthCondition: null, observation: null,
  medication: null, allergy: null, immunization: null, insurancePolicy: null, roomId: null, room: null,
}
const row = (over: Partial<AttachmentOwnerRow>): AttachmentOwnerRow =>
  ({ id: "att1", filename: "3f2a.pdf", originalName: "Manual.pdf", recordType: "SERVICE", ...none, ...over }) as AttachmentOwnerRow

describe("describeAttachment", () => {
  it("links a room file to its property's Rooms tab, opened on the room", () => {
    const r = describeAttachment(row({ recordType: "ROOM", roomId: "r1", room: { name: "Kitchen", propertyId: "p1" } }))
    expect(r.fileHref).toBe("/api/files/room/r1/3f2a.pdf")
    expect(r.record).toEqual({ type: "room", title: "Kitchen", href: "/assets/properties/p1?tab=rooms&open=r1" })
    expect(r.asset).toEqual({ type: "PROPERTY", id: "p1" })
    expect(describeAttachment(row({ recordType: "ROOM" })).record.href).toBeNull()
  })

  it("links a warranty file to its asset page and the file route", () => {
    const r = describeAttachment(row({
      recordType: "WARRANTY", warrantyId: "w1",
      warranty: { productName: "Carrier furnace", assetType: "EQUIPMENT", assetId: "eq1" },
    }))
    expect(r).toEqual({
      attachmentId: "att1",
      fileName: "Manual.pdf",
      fileHref: "/api/files/warranty/w1/3f2a.pdf",
      record: { type: "warranty", title: "Carrier furnace", href: "/assets/equipment/eq1?tab=warranties&open=w1" },
      asset: { type: "EQUIPMENT", id: "eq1" },
    })
  })

  it("deep-links service records and reminders to their tab, named as the UI names them", () => {
    const service = describeAttachment(row({
      recordType: "SERVICE", serviceRecordId: "s1",
      serviceRecord: { title: "Brakes", assetType: "VEHICLE", assetId: "v1" },
    }))
    expect(service.record).toEqual({ type: "service record", title: "Brakes", href: "/assets/vehicles/v1?tab=service&open=s1" })

    const reminder = describeAttachment(row({
      recordType: "MAINTENANCE", maintenanceScheduleId: "ms1",
      maintenanceSchedule: { title: "Filter change", assetType: "PROPERTY", assetId: "pr1" },
    }))
    expect(reminder.record).toEqual({ type: "maintenance reminder", title: "Filter change", href: "/assets/properties/pr1?tab=maintenance&open=ms1" })
  })

  it("uses the person page's tabs: visits, reminders, and no warranties tab", () => {
    const visit = describeAttachment(row({
      recordType: "SERVICE", serviceRecordId: "s1",
      serviceRecord: { title: "Annual physical", assetType: "PERSON", assetId: "p1" },
    }))
    expect(visit.record).toEqual({ type: "visit", title: "Annual physical", href: "/assets/people/p1?tab=visits&open=s1" })

    const reminder = describeAttachment(row({
      recordType: "MAINTENANCE", maintenanceScheduleId: "ms1",
      maintenanceSchedule: { title: "Annual physical", assetType: "PERSON", assetId: "p1" },
    }))
    expect(reminder.record).toEqual({ type: "reminder", title: "Annual physical", href: "/assets/people/p1?tab=reminders&open=ms1" })

    const warranty = describeAttachment(row({
      recordType: "WARRANTY", warrantyId: "w1",
      warranty: { productName: "Hearing aid", assetType: "PERSON", assetId: "p1" },
    }))
    expect(warranty.record.href).toBe("/assets/people/p1")
  })

  it("links health files to the person's tab, opening the item where the tab supports it", () => {
    const med = describeAttachment(row({ recordType: "MEDICATION", medicationId: "m1", medication: { name: "Amoxicillin", personId: "p1" } }))
    expect(med.record).toEqual({ type: "medication", title: "Amoxicillin", href: "/assets/people/p1?tab=medications&open=m1" })
    expect(med.asset).toEqual({ type: "PERSON", id: "p1" })

    const shot = describeAttachment(row({ recordType: "IMMUNIZATION", immunizationId: "i1", immunization: { vaccine: "Tdap", personId: "p1" } }))
    expect(shot.record.href).toBe("/assets/people/p1?tab=immunizations&open=i1")

    const condition = describeAttachment(row({ recordType: "CONDITION", healthConditionId: "c1", healthCondition: { name: "Asthma", personId: "p1" } }))
    expect(condition.record.href).toBe("/assets/people/p1?tab=conditions")

    const allergy = describeAttachment(row({ recordType: "ALLERGY", allergyId: "al1", allergy: { substance: "Penicillin", personId: "p1" } }))
    expect(allergy.record.href).toBe("/assets/people/p1?tab=allergies")

    const obs = describeAttachment(row({
      recordType: "OBSERVATION", observationId: "o1",
      observation: { id: "o1", type: "MELTDOWN", date: new Date("2026-03-04T00:00:00Z"), personId: "p1" },
    }))
    expect(obs.record.title).toBe("MELTDOWN on 2026-03-04")
    expect(obs.record.href).toBe("/assets/people/p1?tab=observations&open=o1")
  })

  it("links insurance files to the insurance page with no asset", () => {
    const r = describeAttachment(row({ recordType: "INSURANCE", insurancePolicyId: "i1", insurancePolicy: { carrier: "Acme Mutual", kind: "HOME" } }))
    expect(r.record).toEqual({ type: "insurance policy", title: "Acme Mutual", href: "/insurance" })
    expect(r.asset).toBeNull()
    expect(r.insuranceKind).toBe("HOME")
  })

  it("survives a missing parent record", () => {
    const r = describeAttachment(row({ recordType: "SERVICE", serviceRecordId: null, serviceRecord: null }))
    expect(r.fileHref).toBeNull()
    expect(r.record).toEqual({ type: "service record", title: "(record not found)", href: null })
  })

  it("links an unfiled file to the Intake page, with no asset", () => {
    expect(describeAttachment(row({ recordType: "INBOX", inboxItemId: "x1", originalName: "receipt.jpg" }))).toEqual({
      attachmentId: "att1",
      fileName: "receipt.jpg",
      fileHref: "/api/files/inbox/x1/3f2a.pdf",
      record: { type: "intake item", title: "receipt.jpg", href: "/intake" },
      asset: null,
    })
  })
})
