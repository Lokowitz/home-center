import { z } from "zod"
import {
  AllergySeverity, ConditionStatus, InsuranceKind, PremiumPeriod, Relationship,
} from "@/app/generated/prisma/enums"
import { coverageRows } from "@/lib/insurance"
import {
  DATE_MESSAGE, MAX_INTERVAL_DAYS, MAX_NAME_LENGTH, NAME_MESSAGE, moneyAmount, numberText, parseDateOnly,
} from "@/lib/input-limits"

// Form values arrive as strings exactly as the inputs hold them. Each schema
// trims, turns blanks into null, parses dates and numbers, and enforces the
// date-order rules, so an action can hand `parsed.data` straight to Prisma.

const requiredText = (message: string) => z.string().trim().min(1, message).max(MAX_NAME_LENGTH, NAME_MESSAGE)
const optionalText = z.string().trim().optional().transform((v) => v || null)
const optionalName = z.string().trim().max(MAX_NAME_LENGTH, NAME_MESSAGE).optional().transform((v) => v || null)
const optionalId = z.string().optional().transform((v) => v || null)

const optionalDate = z
  .string()
  .optional()
  .refine((v) => !v?.trim() || parseDateOnly(v) !== null, DATE_MESSAGE)
  .transform((v) => (v?.trim() ? parseDateOnly(v) : null))

const requiredDate = (message: string) =>
  z.string().min(1, message).refine((v) => parseDateOnly(v) !== null, DATE_MESSAGE).transform((v) => parseDateOnly(v) as Date)

const optionalWholeNumber = z
  .string()
  .optional()
  .refine((v) => !v || /^\d+$/.test(v.trim()), "Enter a whole number")
  .transform((v) => (v ? Number(v) : null))

const optionalMoney = numberText(moneyAmount()).transform((v) => (v?.trim() ? Number(v.trim()) : null))

/// Adds an error on `later` when both dates are set and `later` precedes `earlier`.
function notBefore(later: string, earlier: string, message: string) {
  return (v: Record<string, unknown>, ctx: z.RefinementCtx) => {
    const a = v[earlier]
    const b = v[later]
    if (a instanceof Date && b instanceof Date && b < a) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [later], message })
    }
  }
}

export const personSchema = z.object({
  name: requiredText("Name is required"),
  relationship: z.nativeEnum(Relationship),
  dateOfBirth: optionalDate.refine((d) => !d || d.getTime() <= Date.now(), "Date of birth can't be in the future"),
  sex: optionalText,
  bloodType: optionalText,
  primaryProviderId: optionalId,
  notes: optionalText,
  /** Left out: the link stays as it is. Empty: unlink. */
  propertyId: z.string().optional(),
})

export const providerSchema = z.object({
  name: requiredText("Name is required"),
  specialty: optionalText,
  practice: optionalText,
  phone: optionalText,
  email: optionalText.refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email"),
  address: optionalText,
  notes: optionalText,
})

export const conditionSchema = z
  .object({
    name: requiredText("Condition is required"),
    status: z.nativeEnum(ConditionStatus),
    providerId: optionalId,
    diagnosedDate: optionalDate,
    resolvedDate: optionalDate,
    notes: optionalText,
  })
  // A resolved date belongs to a resolved condition: when the status moves away from Resolved it goes.
  .transform((v) => ({ ...v, resolvedDate: v.status === "RESOLVED" ? v.resolvedDate : null }))
  .superRefine(notBefore("resolvedDate", "diagnosedDate", "Resolved date can't be before diagnosis"))

export const medicationSchema = z
  .object({
    name: requiredText("Medication is required"),
    dosage: optionalText,
    frequency: optionalText,
    prescriberId: optionalId,
    conditionId: optionalId,
    pharmacy: optionalName,
    startDate: optionalDate,
    endDate: optionalDate,
    refillIntervalDays: optionalWholeNumber.refine((v) => v === null || v <= MAX_INTERVAL_DAYS, `Enter ${MAX_INTERVAL_DAYS} days or fewer`),
    nextRefillDate: optionalDate,
    notes: optionalText,
  })
  .superRefine(notBefore("endDate", "startDate", "End date can't be before the start date"))

export const allergySchema = z.object({
  substance: requiredText("Substance is required"),
  severity: z.nativeEnum(AllergySeverity),
  reaction: optionalText,
  notes: optionalText,
})

export const immunizationSchema = z
  .object({
    vaccine: requiredText("Vaccine is required"),
    dateGiven: requiredDate("Date given is required"),
    dose: optionalText,
    givenBy: optionalText,
    nextDueDate: optionalDate,
    notes: optionalText,
  })
  .superRefine(notBefore("nextDueDate", "dateGiven", "Next due can't be before the date given"))

/** "school, Tired ,school" → "school, Tired"; blank → null. */
export function normalizeTags(raw: string | null | undefined): string | null {
  const seen = new Map<string, string>()
  for (const t of (raw ?? "").split(",")) {
    const tag = t.trim().replace(/\s+/g, " ")
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag)
  }
  return seen.size ? [...seen.values()].join(", ") : null
}

export const observationSchema = z.object({
  date: requiredDate("Date is required"),
  time: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Enter a time like 14:30")
    .transform((v) => v || null),
  type: requiredText("What was observed is required").pipe(z.string().max(60, "Keep it under 60 characters")),
  severity: z
    .string()
    .optional()
    .refine((v) => !v || /^[1-5]$/.test(v), "Pick 1 to 5")
    .transform((v) => (v ? Number(v) : null)),
  durationMinutes: optionalWholeNumber.refine((v) => v === null || v <= 7 * 24 * 60, "That's longer than a week"),
  conditionId: optionalId,
  tags: z.string().optional().transform(normalizeTags),
  notes: optionalText,
})

const commaIds = z.string().optional().transform((v) => (v ? v.split(",").filter(Boolean) : []))

export const insuranceSchema = z
  .object({
    carrier: requiredText("Carrier is required"),
    planName: optionalName,
    kind: z.nativeEnum(InsuranceKind),
    policyNumber: optionalText,
    groupNumber: optionalText,
    memberId: optionalText,
    phone: optionalText,
    startDate: optionalDate,
    endDate: optionalDate,
    deductible: optionalMoney,
    outOfPocketMax: optionalMoney,
    notes: optionalText,
    memberIds: commaIds,
    propertyIds: commaIds,
    vehicleIds: commaIds,
    coverages: z
      .array(z.object({ label: optionalText, limit: optionalMoney, deductible: optionalMoney }))
      .optional()
      .default([]),
  })
  .superRefine(notBefore("endDate", "startDate", "End date can't be before the start date"))
  .superRefine((v, ctx) => {
    if (v.coverages.some((c) => !c.label && (c.limit != null || c.deductible != null))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coverages"], message: "Each coverage line needs a name." })
    }
  })
  .transform((v) => ({ ...v, coverages: coverageRows(v.coverages) }))

/// What the policy form sends: ids as comma strings, coverage amounts as strings.
export type PolicyInput = z.input<typeof insuranceSchema>

export const premiumSchema = z.object({
  effectiveDate: requiredDate("Date is required"),
  amount: numberText(moneyAmount(), "Amount is required").transform((v) => Number(v?.trim())),
  period: z.nativeEnum(PremiumPeriod).default("ANNUAL"),
  notes: optionalText,
})
