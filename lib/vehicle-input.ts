import { z } from "zod"
import { optionalNumber } from "./asset-input"
import { boundedNumber, meterReading, moneyAmount, nameText, optionalDateText, optionalNameText, parseDateOnly } from "./input-limits"
import { propertyLinkWrite } from "./property-filter"

export const vehicleSchema = z.object({
  name: nameText("Name is required"),
  make: nameText("Make is required"),
  model: nameText("Model is required"),
  year: boundedNumber(1900, 2100, { whole: true, message: "Enter a year from 1900 to 2100." }),
  vin: optionalNameText,
  color: optionalNameText,
  purchaseDate: optionalDateText,
  purchasePrice: optionalNumber(moneyAmount()),
  currentMileage: optionalNumber(meterReading()),
  meterUnit: z.enum(["MILES", "HOURS"]).default("MILES"),
  notes: z.string().optional(),
  /** Left out: the link stays as it is. Empty: unlink. */
  propertyId: z.string().optional(),
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
    purchaseDate: v.purchaseDate ? parseDateOnly(v.purchaseDate) : null,
    purchasePrice: v.purchasePrice ?? null,
    currentMileage: v.currentMileage ?? null,
    meterUnit: v.meterUnit,
    notes: v.notes || null,
    ...propertyLinkWrite(v.propertyId),
  }
}
