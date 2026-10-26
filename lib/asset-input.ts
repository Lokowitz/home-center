import { z } from "zod"
import { boundedNumber, moneyAmount, nameText, optionalDateText, optionalNameText, parseDateOnly } from "./input-limits"

/**
 * An optional number from a form field. A blank or whitespace-only field means
 * "not entered" and stays undefined — z.coerce.number() alone would turn "" into
 * 0, which saved an empty price as $0.
 */
export function optionalNumber<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((v) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v), inner.optional())
}

export const equipmentSchema = z.object({
  name: nameText("Name is required"),
  category: z.enum(["APPLIANCE", "HVAC", "WATER", "ELECTRONICS", "TOOL", "OUTDOOR", "SECURITY", "OTHER"]),
  manufacturer: optionalNameText,
  modelNumber: optionalNameText,
  serialNumber: optionalNameText,
  location: optionalNameText,
  roomId: z.string().optional(),
  propertyId: z.string().optional(),
  purchaseDate: optionalDateText,
  purchasePrice: optionalNumber(moneyAmount()),
  installDate: optionalDateText,
  /// "" is Default: the category decides (lib/equipment-value.ts).
  valueClass: z.enum(["", "FIXTURE", "CONTENTS"]).optional(),
  expectedLifeYears: optionalNumber(z.coerce.number().int().min(1).max(100)),
  replacementCost: optionalNumber(moneyAmount()),
  notes: z.string().optional(),
})

export type EquipmentInput = z.input<typeof equipmentSchema>

/** The parsed form as the row to save: anything not entered is null. */
export function equipmentData(v: z.infer<typeof equipmentSchema>) {
  return {
    name: v.name,
    category: v.category,
    manufacturer: v.manufacturer || null,
    modelNumber: v.modelNumber || null,
    serialNumber: v.serialNumber || null,
    location: v.location || null,
    roomId: v.roomId || null,
    propertyId: v.propertyId || null,
    purchaseDate: v.purchaseDate ? parseDateOnly(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice ?? null,
    installDate: v.installDate ? parseDateOnly(v.installDate) : null,
    valueClass: v.valueClass || null,
    expectedLifeYears: v.expectedLifeYears ?? null,
    replacementCost: v.replacementCost ?? null,
    notes: v.notes || null,
  }
}

/** A property is bought for something: 0 is refused where other prices allow it. */
export const propertyPrice = moneyAmount().refine((n) => n > 0, "Enter more than 0.")

export const propertySchema = z.object({
  name: nameText("Name is required"),
  type: z.enum(["HOUSE", "CONDO", "TOWNHOUSE", "LOT", "OTHER"]),
  address: z.string().min(1, "Address is required"),
  purchaseDate: optionalDateText,
  purchasePrice: optionalNumber(propertyPrice),
  yearBuilt: optionalNumber(boundedNumber(1800, 2100, { whole: true, message: "Enter a year from 1800 to 2100." })),
  sqFt: optionalNumber(z.coerce.number().int("Enter a whole number.").positive("Enter more than 0.")),
  notes: z.string().optional(),
})

export type PropertyInput = z.input<typeof propertySchema>

/** The parsed form as the row to save: anything not entered is null. */
export function propertyData(v: z.infer<typeof propertySchema>) {
  return {
    name: v.name,
    type: v.type,
    address: v.address,
    purchaseDate: v.purchaseDate ? parseDateOnly(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice ?? null,
    yearBuilt: v.yearBuilt ?? null,
    sqFt: v.sqFt ?? null,
    notes: v.notes || null,
  }
}
