import { z } from "zod"

/**
 * An optional number from a form field. A blank or whitespace-only field means
 * "not entered" and stays undefined — z.coerce.number() alone would turn "" into
 * 0, which saved an empty price as $0.
 */
export function optionalNumber<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess((v) => (v === "" || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v), inner.optional())
}

export const equipmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.enum(["APPLIANCE", "HVAC", "WATER", "ELECTRONICS", "TOOL", "OUTDOOR", "SECURITY", "OTHER"]),
  manufacturer: z.string().optional(),
  modelNumber: z.string().optional(),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  roomId: z.string().optional(),
  propertyId: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: optionalNumber(z.coerce.number().min(0)),
  installDate: z.string().optional(),
  /// "" is Default: the category decides (lib/equipment-value.ts).
  valueClass: z.enum(["", "FIXTURE", "CONTENTS"]).optional(),
  expectedLifeYears: optionalNumber(z.coerce.number().int().min(1).max(100)),
  replacementCost: optionalNumber(z.coerce.number().min(0)),
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
    purchaseDate: v.purchaseDate ? new Date(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice ?? null,
    installDate: v.installDate ? new Date(v.installDate) : null,
    valueClass: v.valueClass || null,
    expectedLifeYears: v.expectedLifeYears ?? null,
    replacementCost: v.replacementCost ?? null,
    notes: v.notes || null,
  }
}

export const propertySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["HOUSE", "CONDO", "TOWNHOUSE", "LOT", "OTHER"]),
  address: z.string().min(1, "Address is required"),
  purchaseDate: z.string().optional(),
  purchasePrice: optionalNumber(z.coerce.number().positive()),
  yearBuilt: optionalNumber(z.coerce.number().int().min(1800).max(2100)),
  sqFt: optionalNumber(z.coerce.number().int().positive()),
  notes: z.string().optional(),
})

export type PropertyInput = z.input<typeof propertySchema>

/** The parsed form as the row to save: anything not entered is null. */
export function propertyData(v: z.infer<typeof propertySchema>) {
  return {
    name: v.name,
    type: v.type,
    address: v.address,
    purchaseDate: v.purchaseDate ? new Date(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice ?? null,
    yearBuilt: v.yearBuilt ?? null,
    sqFt: v.sqFt ?? null,
    notes: v.notes || null,
  }
}
