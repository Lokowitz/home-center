"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireHealth } from "@/lib/features-server"
import { allergySchema, conditionSchema, immunizationSchema, medicationSchema, observationSchema } from "@/lib/health-schemas"
import { nextRefillFrom } from "@/lib/health"
import { orGone } from "@/lib/gone"
import { RANGE_DATE_MESSAGE, dateInRange } from "@/lib/input-limits"
import { removeUploadDir } from "@/lib/upload-fs"
import { STALE_ENTRY } from "@/lib/observation-cards"
import type { ActionResult, FormValues } from "@/lib/form-types"

/** Signed in, and Health switched on: with it off, health records are out of reach here too, not only hidden. */
async function requireSession() {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()
  return session
}

async function personExists(personId: string) {
  return !!(await prisma.person.findUnique({ where: { id: personId }, select: { id: true } }))
}

function revalidatePerson(personId: string) {
  revalidatePath(`/assets/people/${personId}`)
  revalidatePath("/assets/people")
}

const NOT_FOUND: ActionResult = { error: "Not found" }

// ─── Conditions ───────────────────────────────────────────────────────────────

export async function createCondition(personId: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = conditionSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (!(await personExists(personId))) return NOT_FOUND

  const row = await prisma.healthCondition.create({ data: { ...parsed.data, personId } })
  revalidatePerson(personId)
  return { success: true, id: row.id }
}

export async function updateCondition(id: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = conditionSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.healthCondition.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.healthCondition.update({ where: { id }, data: parsed.data })
  revalidatePerson(existing.personId)
  return { success: true }
}

export async function deleteCondition(id: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.healthCondition.findUnique({ where: { id }, select: { id: true, personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.healthCondition.delete({ where: { id: existing.id } })
  await removeUploadDir("condition", existing.id)
  revalidatePerson(existing.personId)
  return { success: true }
}

// ─── Medications ──────────────────────────────────────────────────────────────

export async function createMedication(personId: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = medicationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (!(await personExists(personId))) return NOT_FOUND

  const row = await prisma.medication.create({ data: { ...parsed.data, personId } })
  revalidatePerson(personId)
  return { success: true, id: row.id }
}

export async function updateMedication(id: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = medicationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.medication.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.medication.update({ where: { id }, data: parsed.data })
  revalidatePerson(existing.personId)
  return { success: true }
}

export async function deleteMedication(id: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.medication.findUnique({ where: { id }, select: { id: true, personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.medication.delete({ where: { id: existing.id } })
  revalidatePerson(existing.personId)
  return { success: true }
}

/// Picked up today: the next refill is one interval from today, not from the
/// old due date, so a late pickup doesn't leave the next one already overdue.
export async function markMedicationRefilled(id: string): Promise<ActionResult> {
  await requireSession()
  const med = await prisma.medication.findUnique({ where: { id }, select: { personId: true, refillIntervalDays: true } })
  if (!med) return NOT_FOUND
  if (!med.refillIntervalDays) return { error: "Set a refill interval first." }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const nextRefillDate = nextRefillFrom(today, med.refillIntervalDays)
  // A refill interval saved before the limits can push the date out of range.
  if (!dateInRange(nextRefillDate)) return { error: RANGE_DATE_MESSAGE }
  const saved = await orGone(() => prisma.medication.update({ where: { id }, data: { nextRefillDate } }))
  if (saved) return { error: saved.error }
  revalidatePerson(med.personId)
  return { success: true }
}

// ─── Allergies ────────────────────────────────────────────────────────────────

export async function createAllergy(personId: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = allergySchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (!(await personExists(personId))) return NOT_FOUND

  const row = await prisma.allergy.create({ data: { ...parsed.data, personId } })
  revalidatePerson(personId)
  return { success: true, id: row.id }
}

export async function updateAllergy(id: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = allergySchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.allergy.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.allergy.update({ where: { id }, data: parsed.data })
  revalidatePerson(existing.personId)
  return { success: true }
}

export async function deleteAllergy(id: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.allergy.findUnique({ where: { id }, select: { id: true, personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.allergy.delete({ where: { id: existing.id } })
  revalidatePerson(existing.personId)
  return { success: true }
}

// ─── Immunizations ────────────────────────────────────────────────────────────

export async function createImmunization(personId: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = immunizationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (!(await personExists(personId))) return NOT_FOUND

  const row = await prisma.immunization.create({ data: { ...parsed.data, personId } })
  revalidatePerson(personId)
  return { success: true, id: row.id }
}

export async function updateImmunization(id: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = immunizationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.immunization.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.immunization.update({ where: { id }, data: parsed.data })
  revalidatePerson(existing.personId)
  return { success: true }
}

export async function deleteImmunization(id: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.immunization.findUnique({ where: { id }, select: { id: true, personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.immunization.delete({ where: { id: existing.id } })
  revalidatePerson(existing.personId)
  return { success: true }
}

// ─── Observations ─────────────────────────────────────────────────────────────

/** A linked condition must be one of this person's own. */
async function conditionError(personId: string, conditionId: string | null): Promise<ActionResult | null> {
  if (!conditionId) return null
  const c = await prisma.healthCondition.findUnique({ where: { id: conditionId }, select: { personId: true } })
  return c?.personId === personId ? null : { error: { conditionId: ["Pick one of this person's conditions"] } }
}

export async function createObservation(personId: string, values: FormValues): Promise<ActionResult> {
  const session = await requireSession()
  const parsed = observationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (!(await personExists(personId))) return NOT_FOUND
  const bad = await conditionError(personId, parsed.data.conditionId)
  if (bad) return bad

  const row = await prisma.observation.create({ data: { ...parsed.data, personId, createdById: session.user.id } })
  revalidatePerson(personId)
  return { success: true, id: row.id }
}

export async function updateObservation(id: string, values: FormValues): Promise<ActionResult> {
  await requireSession()
  const parsed = observationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.observation.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND
  const bad = await conditionError(existing.personId, parsed.data.conditionId)
  if (bad) return bad

  await prisma.observation.update({ where: { id }, data: parsed.data })
  revalidatePerson(existing.personId)
  return { success: true }
}

export async function deleteObservation(id: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.observation.findUnique({ where: { id }, select: { id: true, personId: true } })
  if (!existing) return NOT_FOUND

  await prisma.observation.delete({ where: { id: existing.id } })
  await removeUploadDir("observation", existing.id)
  revalidatePerson(existing.personId)
  return { success: true }
}

/** An edit from an assistant card: applied only if the entry is as the card saw it. */
export async function applyObservationEdit(id: string, values: FormValues, expectedUpdatedAt: string): Promise<ActionResult> {
  await requireSession()
  const parsed = observationSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.observation.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND
  const bad = await conditionError(existing.personId, parsed.data.conditionId)
  if (bad) return bad
  // Atomic: the filter on updatedAt is the check.
  const { count } = await prisma.observation.updateMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) }, data: parsed.data })
  if (count === 0) return { error: STALE_ENTRY }
  revalidatePerson(existing.personId)
  return { success: true, id }
}

/** A delete from an assistant card, refused if the entry changed since the card was made. */
export async function deleteObservationIfUnchanged(id: string, expectedUpdatedAt: string): Promise<ActionResult> {
  await requireSession()
  const existing = await prisma.observation.findUnique({ where: { id }, select: { personId: true } })
  if (!existing) return NOT_FOUND
  const { count } = await prisma.observation.deleteMany({ where: { id, updatedAt: new Date(expectedUpdatedAt) } })
  if (count === 0) return { error: STALE_ENTRY }
  await removeUploadDir("observation", id)
  revalidatePerson(existing.personId)
  return { success: true }
}
