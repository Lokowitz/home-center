"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { orGone } from "@/lib/gone"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireHealth } from "@/lib/features-server"
import { personSchema } from "@/lib/health-schemas"
import { assetPolicyLinks } from "@/lib/insurance-server"
import { removeUploadDir } from "@/lib/upload-fs"
import { propertyLinkWrite } from "@/lib/property-filter"
import { loadPropertyScope } from "@/lib/property-filter-server"
import type { ActionResult, FormValues } from "@/lib/form-types"

/** A non-empty propertyId must name a real property. */
async function unknownProperty(propertyId: string | undefined) {
  if (!propertyId) return false
  return !(await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true } }))
}

const BAD_PROPERTY = { error: { propertyId: ["Pick a property from the list."] } }

export async function createPerson(values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const parsed = personSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (await unknownProperty(parsed.data.propertyId)) return BAD_PROPERTY

  const { propertyId, ...fields } = parsed.data
  const person = await prisma.person.create({ data: { ...fields, ...propertyLinkWrite(propertyId) } })
  revalidatePath("/assets/people")
  return { success: true, id: person.id }
}

export async function updatePerson(id: string, values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()
  const scope = await loadPropertyScope()

  const parsed = personSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  if (await unknownProperty(parsed.data.propertyId)) return BAD_PROPERTY

  // The Insurance list is only sent while it's shown; without the key the person's links stay as they are.
  const links = "insurancePolicyIds" in values
    ? await assetPolicyLinks("members", id, values.insurancePolicyIds.split(",").filter(Boolean), true, scope)
    : null
  const { propertyId, ...fields } = parsed.data
  const saved = await orGone(() => prisma.person.update({
    where: { id },
    data: {
      ...fields,
      ...propertyLinkWrite(propertyId),
      ...(links ? { insurancePolicies: { connect: links.connect.map((p) => ({ id: p })), disconnect: links.disconnect.map((p) => ({ id: p })) } } : {}),
    },
  }))
  if (saved) return { error: saved.error }
  revalidatePath("/assets/people")
  revalidatePath(`/assets/people/${id}`)
  if (links) revalidatePath("/insurance")
  return { success: true }
}

export async function deletePerson(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  await requireHealth()

  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true, conditions: { select: { id: true } }, observations: { select: { id: true } } },
  })
  if (!person) return { error: "Not found" }

  const where = { assetType: "PERSON" as const, assetId: person.id }
  const [visits, schedules] = await Promise.all([
    prisma.serviceRecord.findMany({ where, select: { id: true } }),
    prisma.maintenanceSchedule.findMany({ where, select: { id: true } }),
  ])

  // Visits, reminders and documents are keyed polymorphically with no foreign key, so the
  // person's own cascade can't reach them — they go in the same transaction.
  await prisma.$transaction([
    prisma.serviceRecord.deleteMany({ where }),
    prisma.maintenanceSchedule.deleteMany({ where }),
    prisma.attachment.deleteMany({ where: { ...where, recordType: "DOCUMENT" } }),
    prisma.person.delete({ where: { id: person.id } }),
  ])

  const dirs: [string, string][] = [
    ["people", person.id],
    ["document", person.id],
    ...visits.map((v): [string, string] => ["service", v.id]),
    ...schedules.map((s): [string, string] => ["maintenance", s.id]),
    ...person.conditions.map((c): [string, string] => ["condition", c.id]),
    ...person.observations.map((o): [string, string] => ["observation", o.id]),
  ]
  for (const dir of dirs) await removeUploadDir(...dir)

  revalidatePath("/assets/people")
  revalidatePath("/records")
  revalidatePath("/maintenance")
  return { success: true }
}
