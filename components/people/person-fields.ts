import { RELATIONSHIPS, toDateInput } from "@/lib/health"
import type { FieldConfig, FormValues } from "@/lib/form-types"
import type { Person } from "@/app/generated/prisma/client"

/// `policies` are the health and life policies that may cover a person. Edit only: empty hides the Insurance list.
export function personFields(providers: { id: string; name: string }[], policies: { id: string; name: string }[] = []): FieldConfig[] {
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
    { name: "notes", label: "Notes", kind: "textarea", wide: true, help: "person.notes" },
    ...(policies.length > 0
      ? [{ name: "insurancePolicyIds", label: "Insurance", kind: "checkboxes" as const, wide: true, help: "person.insurance", options: policies.map((p) => ({ value: p.id, label: p.name })) }]
      : []),
  ]
}

/// `policyIds` are the policies covering this person now; leave it out when the Insurance list isn't shown.
export function personInitial(person?: Person | null, policyIds?: string[]): FormValues {
  return {
    name: person?.name ?? "",
    relationship: person?.relationship ?? "SELF",
    dateOfBirth: toDateInput(person?.dateOfBirth),
    sex: person?.sex ?? "",
    bloodType: person?.bloodType ?? "",
    primaryProviderId: person?.primaryProviderId ?? "",
    notes: person?.notes ?? "",
    ...(policyIds ? { insurancePolicyIds: policyIds.join(",") } : {}),
  }
}
