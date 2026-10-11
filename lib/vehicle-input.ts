import { z } from "zod"
import { optionalNumber } from "./asset-input"

export const vehicleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce.number().int().min(1900).max(2100),
  vin: z.string().optional(),
  color: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchasePrice: optionalNumber(z.coerce.number()),
  currentMileage: optionalNumber(z.coerce.number().int().min(0)),
  meterUnit: z.enum(["MILES", "HOURS"]).default("MILES"),
  notes: z.string().optional(),
})

export type VehicleInput = z.input<typeof vehicleSchema>

/** The parsed form as the row to save: anything not entered is null. */
export function vehicleData(v: z.infer<typeof vehicleSchema>) {
  return {
    name: v.name,
    make: v.make,
    model: v.model,
    year: Number(v.year),
    vin: v.vin || null,
    color: v.color || null,
    purchaseDate: v.purchaseDate ? new Date(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice ?? null,
    currentMileage: v.currentMileage ?? null,
    meterUnit: v.meterUnit,
    notes: v.notes || null,
  }
}
