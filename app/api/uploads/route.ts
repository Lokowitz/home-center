import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { resolveUploadPath } from "@/lib/upload-path"
import { maxUploadBytes, oversizedBody } from "@/lib/upload-limits"
import { extensionForFilename, UPLOAD_TYPES } from "@/lib/upload-types"
import { enqueueDocument } from "@/lib/documents/indexer-server"
import { loadFeatures } from "@/lib/features-server"
import { loadDocumentSettings } from "@/lib/documents/settings"
import { processInboxItem } from "@/lib/capture-server"
import { isHealthInsuranceKind } from "@/lib/insurance"
import type { AssetType } from "@/app/generated/prisma/client"

const RECORD_TYPES = ["SERVICE", "WARRANTY", "MAINTENANCE", "CONDITION", "INSURANCE", "OBSERVATION", "MEDICATION", "ALLERGY", "IMMUNIZATION", "DOCUMENT", "INBOX", "ROOM"] as const
type RecordType = (typeof RECORD_TYPES)[number]

function isRecordType(v: string | null): v is RecordType {
  return v !== null && (RECORD_TYPES as readonly string[]).includes(v)
}

// The record must exist before anything touches the disk: the id becomes a
// directory name, and a made-up id must not be able to create one.
async function recordExists(type: Exclude<RecordType, "DOCUMENT">, id: string): Promise<boolean> {
  const where = { where: { id }, select: { id: true } } as const
  if (type === "SERVICE") return !!(await prisma.serviceRecord.findUnique(where))
  if (type === "WARRANTY") return !!(await prisma.warranty.findUnique(where))
  if (type === "MAINTENANCE") return !!(await prisma.maintenanceSchedule.findUnique(where))
  if (type === "CONDITION") return !!(await prisma.healthCondition.findUnique(where))
  if (type === "OBSERVATION") return !!(await prisma.observation.findUnique(where))
  if (type === "MEDICATION") return !!(await prisma.medication.findUnique(where))
  if (type === "ALLERGY") return !!(await prisma.allergy.findUnique(where))
  if (type === "IMMUNIZATION") return !!(await prisma.immunization.findUnique(where))
  // Any signed-in member of the household may add to the shared inbox.
  if (type === "INBOX") return !!(await prisma.inboxItem.findUnique(where))
  if (type === "ROOM") return !!(await prisma.room.findUnique(where))
  return !!(await prisma.insurancePolicy.findUnique(where))
}

// A document's recordId is the asset's own id. Ids are cuids, unique across
// tables, so whichever asset table holds it says what kind of asset it is.
async function documentAssetType(id: string): Promise<AssetType | null> {
  const where = { where: { id }, select: { id: true } } as const
  const [property, vehicle, equipment, person] = await Promise.all([
    prisma.property.findUnique(where),
    prisma.vehicle.findUnique(where),
    prisma.equipment.findUnique(where),
    prisma.person.findUnique(where),
  ])
  if (property) return "PROPERTY"
  if (vehicle) return "VEHICLE"
  if (equipment) return "EQUIPMENT"
  if (person && (await loadFeatures()).health) return "PERSON"
  return null
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const maxBytes = maxUploadBytes()
  const tooBig = oversizedBody(request.headers, maxBytes)
  if (tooBig) return NextResponse.json({ error: tooBig.error }, { status: tooBig.status })
  const formData = await request.formData()
  const file = formData.get("file") as File | null
  const recordId = formData.get("recordId") as string | null
  const recordType = formData.get("recordType") as string | null

  if (!file || !recordId || !isRecordType(recordType)) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 })
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ error: `File exceeds maximum size of ${Math.round(maxBytes / 1024 / 1024)} MB.` }, { status: 400 })
  }
  const ext = extensionForFilename(file.name)
  if (!ext) {
    return NextResponse.json({ error: "File type not allowed." }, { status: 400 })
  }
  if (recordType === "ROOM" && !(await loadFeatures()).rooms) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 })
  }
  if (recordType === "INSURANCE" && !(await loadFeatures()).health) {
    const policy = await prisma.insurancePolicy.findUnique({ where: { id: recordId }, select: { kind: true } })
    if (policy && isHealthInsuranceKind(policy.kind)) return NextResponse.json({ error: "Record not found" }, { status: 404 })
  }
  const documentOn = recordType === "DOCUMENT" ? await documentAssetType(recordId) : null
  if (recordType === "DOCUMENT" ? !documentOn : !(await recordExists(recordType, recordId))) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 })
  }

  const dirPath = resolveUploadPath(recordType.toLowerCase(), recordId)
  const filename = `${randomUUID()}${ext}`
  await mkdir(dirPath, { recursive: true })
  await writeFile(path.join(dirPath, filename), Buffer.from(await file.arrayBuffer()))

  const attachment = await prisma.attachment.create({
    data: {
      recordType,
      filename,
      originalName: file.name,
      mimeType: UPLOAD_TYPES[ext],
      sizeBytes: file.size,
      uploadedById: session.user.id,
      serviceRecordId: recordType === "SERVICE" ? recordId : null,
      warrantyId: recordType === "WARRANTY" ? recordId : null,
      maintenanceScheduleId: recordType === "MAINTENANCE" ? recordId : null,
      healthConditionId: recordType === "CONDITION" ? recordId : null,
      insurancePolicyId: recordType === "INSURANCE" ? recordId : null,
      observationId: recordType === "OBSERVATION" ? recordId : null,
      medicationId: recordType === "MEDICATION" ? recordId : null,
      allergyId: recordType === "ALLERGY" ? recordId : null,
      immunizationId: recordType === "IMMUNIZATION" ? recordId : null,
      assetType: documentOn,
      assetId: recordType === "DOCUMENT" ? recordId : null,
      inboxItemId: recordType === "INBOX" ? recordId : null,
      roomId: recordType === "ROOM" ? recordId : null,
      // Every upload is indexed in the background; the response doesn't wait.
      text: { create: {} },
    },
  })

  enqueueDocument(attachment.id)
  // With indexing off nothing will read the file, so the item is settled now
  // (ready to file by hand) instead of waiting forever.
  if (recordType === "INBOX" && !(await loadDocumentSettings()).indexingEnabled) await processInboxItem(recordId)
  return NextResponse.json({ attachment })
}
