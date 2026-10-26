import { z } from "zod"

// Limits for dates, money, readings, intervals and names, and the zod pieces that enforce them.
// Pure (no server imports), so the dialogs and the server actions apply the same rules.

export const MIN_DATE = "1900-01-01"
export const MAX_DATE = "2200-12-31"
export const MAX_MONEY = 10_000_000
export const MAX_METER = 10_000_000
export const MAX_INTERVAL_DAYS = 3650
export const MAX_INTERVAL_MILES = 1_000_000
export const MAX_NAME_LENGTH = 200

export const DATE_MESSAGE = "Pick a date between 1900 and 2200."
export const NAME_MESSAGE = `Keep it to ${MAX_NAME_LENGTH} characters or fewer.`

const grouped = (n: number) => n.toLocaleString("en-US")
const NUMBER_MESSAGE = "Enter a number, like 89.99."
const WHOLE_MESSAGE = "Enter a whole number."

/**
 * A date-only value as the date input holds it ("2024-05-31") as UTC midnight, or null when it
 * isn't a real calendar day from MIN_DATE through MAX_DATE. Rejects six-digit years, "0001" and
 * anything else Date.parse would read as something else.
 */
export function parseDateOnly(v: string): Date | null {
  const t = v.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || t < MIN_DATE || t > MAX_DATE) return null
  const d = new Date(`${t}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? d : null
}

/** A blank (or all-space) field is fine; a filled one must be a date in range. */
export const optionalDateText = z
  .string()
  .optional()
  .refine((v) => !v?.trim() || parseDateOnly(v) !== null, DATE_MESSAGE)

export const requiredDateText = (message: string) =>
  z.string().min(1, message).refine((v) => !v || parseDateOnly(v) !== null, DATE_MESSAGE)

/** A typed value as a number: plain decimals only, so "1e21", "0x10" and "Infinity" come out as NaN. */
function toNumber(v: unknown) {
  if (typeof v !== "string") return v
  const t = v.trim()
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN
}

/**
 * A number from a field or a number, between min and max. `message` replaces the range message.
 * Every failure is a custom issue, not a type error, so inside `z.literal("").or(...)` the
 * message still comes through instead of a bare "Invalid input".
 */
export function boundedNumber(min: number, max: number, { whole = false, message }: { whole?: boolean; message?: string } = {}) {
  const range = message ?? `Enter ${whole ? "a whole number" : "a number"} from ${grouped(min)} to ${grouped(max)}.`
  return z.unknown().transform((v, ctx) => {
    const n = toNumber(v)
    const problem =
      typeof n !== "number" || !Number.isFinite(n) ? (whole ? WHOLE_MESSAGE : NUMBER_MESSAGE)
      : whole && !Number.isInteger(n) ? WHOLE_MESSAGE
      : n < min || n > max ? range
      : null
    if (problem) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem })
      return z.NEVER
    }
    return n as number
  })
}

/** Money: 0 up to MAX_MONEY. A negative amount is only allowed where `negative` is set (a refund on a service record). */
export const moneyAmount = ({ negative = false } = {}) =>
  boundedNumber(negative ? -MAX_MONEY : 0, MAX_MONEY, { message: `Enter an amount from ${negative ? "-" : ""}${grouped(negative ? MAX_MONEY : 0)} to ${grouped(MAX_MONEY)}.` })

/** Mileage, odometer and meter readings. */
export const meterReading = () => boundedNumber(0, MAX_METER, { whole: true })

export const intervalDays = () => boundedNumber(1, MAX_INTERVAL_DAYS, { whole: true })
export const intervalMiles = () => boundedNumber(1, MAX_INTERVAL_MILES, { whole: true })

/** Name-like text: required, at most MAX_NAME_LENGTH characters. */
export const nameText = (requiredMessage: string) => z.string().min(1, requiredMessage).max(MAX_NAME_LENGTH, NAME_MESSAGE)

export const optionalNameText = z.string().max(MAX_NAME_LENGTH, NAME_MESSAGE).optional()

/** Why typed text isn't an acceptable `number` (the message the server gives), or null. Blank is fine. */
export function fieldIssue(number: z.ZodTypeAny, v: string | undefined): string | null {
  if (!v?.trim()) return null
  const result = number.safeParse(v)
  return result.success ? null : result.error.issues[0].message
}

/**
 * A form field that holds a number as text. Blank is fine unless `required` is a message; a filled
 * one must pass `number`, with the same message the server gives.
 */
export function numberText(number: z.ZodTypeAny, required?: string) {
  const base = required ? z.string().min(1, required) : z.string().optional()
  return base.superRefine(numberTextCheck(number))
}

/** The superRefine callback behind numberText, for a field that is a plain `z.string()`. */
export function numberTextCheck(number: z.ZodTypeAny) {
  return (v: string | undefined, ctx: z.RefinementCtx) => {
    const message = fieldIssue(number, v)
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  }
}

export const RANGE_DATE_MESSAGE = "That would land on a date outside 1900 to 2200. Check the repeat interval."

/** A real date from MIN_DATE through MAX_DATE (for dates the server works out, such as a next due date). Null passes. */
export function dateInRange(d: Date | null | undefined): boolean {
  if (d == null) return true
  const t = d.getTime()
  return !Number.isNaN(t) && t >= Date.parse(MIN_DATE) && t <= Date.parse(`${MAX_DATE}T23:59:59.999Z`)
}
