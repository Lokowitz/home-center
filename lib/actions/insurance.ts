"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { loadFeatures } from "@/lib/features-server"
import { insuranceSchema, premiumSchema, type PolicyInput } from "@/lib/health-schemas"
import { isHealthInsuranceKind, linkWrites, type LinkIds } from "@/lib/insurance"
import { loadPolicyLinkChoices } from "@/lib/insurance-server"
import { keepHiddenLinks, type PropertyScope } from "@/lib/property-filter"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { orGone } from "@/lib/gone"
import { removeUploadDir } from "@/lib/upload-fs"
import type { ActionResult, FormValues } from "@/lib/form-types"

// Policies show in every covered person's aside and on property and vehicle pages, so those
// subtrees are revalidated along with the insurance page.
function revalidateInsurance() {
  revalidatePath("/insurance")
  revalidatePath("/assets/people", "layout")
  revalidatePath("/assets/properties", "layout")
  revalidatePath("/assets/vehicles", "layout")
}

/// A health-kind policy doesn't exist as far as callers go while Health is off.
function hidden(kind: string, health: boolean) {
  return !health && isHealthInsuranceKind(kind)
}

/// The form only offered in-scope people, properties and vehicles, so links it couldn't show are
/// added back before the `set` writes. With Health off members aren't written, so they're left as chosen.
async function withHiddenLinks(id: string, health: boolean, scope: PropertyScope, chosen: LinkIds): Promise<LinkIds> {
  const linked = { select: { id: true } }
  const [current, visible] = await Promise.all([
    prisma.insurancePolicy.findUnique({ where: { id }, select: { members: linked, properties: linked, vehicles: linked } }),
    loadPolicyLinkChoices(health, scope),
  ])
  const ids = (rows: { id: string }[] | undefined) => (rows ?? []).map((r) => r.id)
  return {
    memberIds: health ? keepHiddenLinks(ids(current?.members), chosen.memberIds, ids(visible.people)) : chosen.memberIds,
    propertyIds: keepHiddenLinks(ids(current?.properties), chosen.propertyIds, ids(visible.properties)),
    vehicleIds: keepHiddenLinks(ids(current?.vehicles), chosen.vehicleIds, ids(visible.vehicles)),
  }
}

export async function createInsurancePolicy(values: PolicyInput): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  const features = await loadFeatures()

  const parsed = insuranceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const { memberIds, propertyIds, vehicleIds, coverages, ...data } = parsed.data

  const links = linkWrites(data.kind, features.health, { memberIds, propertyIds, vehicleIds })
  if (!links.ok) return { error: { [links.field]: [links.error] } }
  const healthKind = isHealthInsuranceKind(data.kind)

  const policy = await prisma.insurancePolicy.create({
    data: {
      ...data,
      // Member ID, group number and out-of-pocket max only mean something for health plans.
      ...(healthKind ? {} : { groupNumber: null, memberId: null, outOfPocketMax: null }),
      ...(links.members ? { members: { connect: links.members.map((id) => ({ id })) } } : {}),
      properties: { connect: links.properties.map((id) => ({ id })) },
      vehicles: { connect: links.vehicles.map((id) => ({ id })) },
      coverages: { create: coverages },
    },
  })
  revalidateInsurance()
  return { success: true, id: policy.id }
}

export async function updateInsurancePolicy(id: string, values: PolicyInput): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  const scope = await loadPropertyScope()
  const features = await loadFeatures()

  const parsed = insuranceSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }
  const existing = await prisma.insurancePolicy.findUnique({ where: { id }, select: { id: true, kind: true } })
  if (!existing || hidden(existing.kind, features.health)) return { error: "Not found" }
  const { memberIds, propertyIds, vehicleIds, coverages, ...data } = parsed.data

  const chosen = { memberIds, propertyIds, vehicleIds }
  const ids = scope ? await withHiddenLinks(id, features.health, scope, chosen) : chosen
  const links = linkWrites(data.kind, features.health, ids)
  if (!links.ok) return { error: { [links.field]: [links.error] } }
  const healthKind = isHealthInsuranceKind(data.kind)

  const saved = await orGone(() => prisma.$transaction([
    prisma.insuranceCoverage.deleteMany({ where: { policyId: id } }),
    prisma.insurancePolicy.update({
      where: { id },
      data: {
        ...data,
        ...(healthKind ? {} : { groupNumber: null, memberId: null, outOfPocketMax: null }),
        // Left out with Health off, so editing a life policy doesn't wipe who it covers.
        ...(links.members ? { members: { set: links.members.map((memberId) => ({ id: memberId })) } } : {}),
        properties: { set: links.properties.map((propertyId) => ({ id: propertyId })) },
        vehicles: { set: links.vehicles.map((vehicleId) => ({ id: vehicleId })) },
      },
    }),
    prisma.insuranceCoverage.createMany({ data: coverages.map((c) => ({ ...c, policyId: id })) }),
  ]))
  if (saved) return { error: saved.error }
  revalidateInsurance()
  return { success: true }
}

export async function deleteInsurancePolicy(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  const features = await loadFeatures()

  const existing = await prisma.insurancePolicy.findUnique({ where: { id }, select: { id: true, kind: true } })
  if (!existing || hidden(existing.kind, features.health)) return { error: "Not found" }

  await prisma.insurancePolicy.delete({ where: { id: existing.id } })
  await removeUploadDir("insurance", existing.id)
  revalidateInsurance()
  return { success: true }
}

export async function addInsurancePremium(policyId: string, values: FormValues): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  const features = await loadFeatures()

  const policy = await prisma.insurancePolicy.findUnique({ where: { id: policyId }, select: { kind: true } })
  if (!policy || hidden(policy.kind, features.health)) return { error: "Not found" }
  const parsed = premiumSchema.safeParse(values)
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors }

  const premium = await prisma.insurancePremium.create({ data: { ...parsed.data, policyId } })
  revalidateInsurance()
  return { success: true, id: premium.id }
}

export async function deleteInsurancePremium(id: string): Promise<ActionResult> {
  const session = await auth()
  if (!session) redirect("/login")
  const features = await loadFeatures()

  const premium = await prisma.insurancePremium.findUnique({ where: { id }, select: { id: true, policy: { select: { kind: true } } } })
  if (!premium || hidden(premium.policy.kind, features.health)) return { error: "Not found" }

  await prisma.insurancePremium.delete({ where: { id } })
  revalidateInsurance()
  return { success: true }
}
