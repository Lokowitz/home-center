import { describe, expect, it } from "vitest"
import { attachmentDir } from "./attachment-location"

const base = {
  serviceRecordId: null, warrantyId: null, maintenanceScheduleId: null, healthConditionId: null,
  insurancePolicyId: null, observationId: null, medicationId: null, allergyId: null, immunizationId: null, assetId: null, inboxItemId: null, roomId: null,
}

describe("attachmentDir", () => {
  it("uses the foreign key that matches the record type", () => {
    expect(attachmentDir({ ...base, recordType: "SERVICE", serviceRecordId: "s1" })).toEqual(["service", "s1"])
    expect(attachmentDir({ ...base, recordType: "WARRANTY", warrantyId: "w1" })).toEqual(["warranty", "w1"])
    expect(attachmentDir({ ...base, recordType: "MAINTENANCE", maintenanceScheduleId: "m1" })).toEqual(["maintenance", "m1"])
  })

  it("returns null when the matching key is missing", () => {
    expect(attachmentDir({ ...base, recordType: "SERVICE", warrantyId: "w1" })).toBeNull()
  })

  it("locates observation files", () => {
    expect(attachmentDir({ ...base, recordType: "OBSERVATION", observationId: "o1" })).toEqual(["observation", "o1"])
  })

  it("locates condition and insurance files", () => {
    expect(attachmentDir({ ...base, recordType: "CONDITION", healthConditionId: "c1" })).toEqual(["condition", "c1"])
    expect(attachmentDir({ ...base, recordType: "INSURANCE", insurancePolicyId: "i1" })).toEqual(["insurance", "i1"])
  })

  it("locates medication, allergy and immunization files", () => {
    expect(attachmentDir({ ...base, recordType: "MEDICATION", medicationId: "m1" })).toEqual(["medication", "m1"])
    expect(attachmentDir({ ...base, recordType: "ALLERGY", allergyId: "a1" })).toEqual(["allergy", "a1"])
    expect(attachmentDir({ ...base, recordType: "IMMUNIZATION", immunizationId: "i1" })).toEqual(["immunization", "i1"])
  })

  it("locates documents filed on the asset itself", () => {
    expect(attachmentDir({ ...base, recordType: "DOCUMENT", assetId: "v1" })).toEqual(["document", "v1"])
    expect(attachmentDir({ ...base, recordType: "DOCUMENT", serviceRecordId: "s1" })).toBeNull()
  })

  it("locates files waiting in the capture inbox", () => {
    expect(attachmentDir({ ...base, recordType: "INBOX", inboxItemId: "x1" })).toEqual(["inbox", "x1"])
    expect(attachmentDir({ ...base, recordType: "INBOX", assetId: "v1" })).toBeNull()
  })

  it("locates room files", () => {
    expect(attachmentDir({ ...base, recordType: "ROOM", roomId: "r1" })).toEqual(["room", "r1"])
    expect(attachmentDir({ ...base, recordType: "ROOM", assetId: "p1" })).toBeNull()
  })
})
