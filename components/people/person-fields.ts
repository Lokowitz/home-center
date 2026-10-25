import { RELATIONSHIPS, toDateInput } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Person } from "@/app/generated/prisma/client"

/// A filter can leave out the property this person is linked to; keep it selectable so saving doesn't unlink it.
export function propertiesWithLinked(properties: { id: string; name: string }[] | undefined, person?: Person | null) {
  if (!properties || !person?.propertyId || properties.some((p) => p.id === person.propertyId)) return properties
  return [...properties, { id: person.propertyId, name: "Linked property" }]
}

/// `policies` are the health and life policies that may cover a person. Edit only: empty hides the Insurance list.
/// `properties` are the properties to pick from. Absent: no Property field, and the person's link is left alone.
export function personFields(providers: { id: string; name: string }[], policies: { id: string; name: string }[] = [], properties?: { id: string; name: string }[]): FieldConfig[] {
  return [
    { name: "name", label: "Name", kind: "text", required: true, placeholder: "Jordan Rivera", wide: true, help: "person.name" },
    { name: "relationship", label: "Relationship", kind: "select", required: true, options: RELATIONSHIPS, help: "person.relationship" },
    { name: "dateOfBirth", label: "Date of birth", kind: "date", help: "person.date-of-birth" },
    { name: "sex", label: "Sex", kind: "text", placeholder: "F", help: "person.sex" },
    { name: "bloodType", label: "Blood type", kind: "text", placeholder: "O+", help: "person.blood-type" },
    {
      name: "primaryProviderId", label: "Primary care provider", kind: "select", wide: true, help: "person.primary-provider",
      options: providers.map((p) => ({ value: p.id, label: p.name })),
    },
    ...(properties
      ? [{ name: "propertyId", label: "Property", kind: "select" as const, wide: true, help: "person.property", emptyLabel: "Not assigned", options: properties.map((p) => ({ value: p.id, label: p.name })) }]
      : []),
    { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "person.notes" },
    ...(policies.length > 0
      ? [{ name: "insurancePolicyIds", label: "Insurance", kind: "checkboxes" as const, wide: true, help: "person.insurance", options: policies.map((p) => ({ value: p.id, label: p.name })) }]
      : []),
  ]
}

/// `policyIds` are the policies covering this person now; leave it out when the Insurance list isn't shown.
/// `withProperty` adds the property link; leave it off when the Property field isn't shown so saving can't touch the link.
/// `newPropertyId` is the property a new person starts on ("" for Not assigned); ignored when editing.
export function personInitial(person?: Person | null, policyIds?: string[], withProperty = false, newPropertyId = ""): FormValues {
  return {
    name: person?.name ?? "",
    relationship: person?.relationship ?? "SELF",
    dateOfBirth: toDateInput(person?.dateOfBirth),
    sex: person?.sex ?? "",
    bloodType: person?.bloodType ?? "",
    primaryProviderId: person?.primaryProviderId ?? "",
    notes: person?.notes ?? "",
    ...(policyIds ? { insurancePolicyIds: policyIds.join(",") } : {}),
    ...(withProperty ? { propertyId: person ? (person.propertyId ?? "") : newPropertyId } : {}),
  }
}
