import type { EquipmentCategory, MeterUnit, PropertyType } from "@/app/generated/prisma/client"
import { firstCalendarDue } from "@/lib/maintenance-schedule"

// Generic starting reminders offered after an asset is created. They're common
// rules of thumb, not manufacturer schedules: the picker says so, and every
// interval can be changed before (and after) the reminders are made.

export type MaintenanceTemplate = {
  /** Stable id within its asset kind; the picker posts these back. */
  key: string
  title: string
  description?: string
  intervalDays?: number
  /** Miles, or hours for a vehicle tracked in hours. */
  intervalMiles?: number
  /** Months 1–12 for a reminder on set months, in place of an interval. */
  dueMonths?: number[]
  /** Day of month (1–28) for dueMonths; 1 when left out. */
  dueDay?: number
  /** Warning window on the meter side; the schedule default (500) suits miles only. */
  reminderMilesBefore?: number
}

/** What the template list depends on, per asset kind. People get none. */
export type TemplateAsset =
  | { type: "PROPERTY"; propertyType: PropertyType }
  | { type: "VEHICLE"; meterUnit: MeterUnit }
  | { type: "EQUIPMENT"; category: EquipmentCategory }

const HOUSE: MaintenanceTemplate[] = [
  { key: "hvac-filter", title: "Replace HVAC filter", intervalDays: 90 },
  { key: "smoke-co-test", title: "Test smoke and CO detectors", intervalDays: 180 },
  { key: "gutters", title: "Clean gutters", intervalDays: 180 },
  { key: "water-heater-flush", title: "Flush water heater", intervalDays: 365 },
  { key: "dryer-vent", title: "Clean dryer vent", intervalDays: 365 },
  { key: "hvac-service", title: "HVAC professional service", intervalDays: 365 },
  { key: "service-ac", title: "Service A/C", dueMonths: [4] },
  { key: "sprinklers-start", title: "Start up sprinklers", dueMonths: [4] },
  { key: "sprinklers-winterize", title: "Winterize sprinklers", dueMonths: [10] },
  { key: "furnace-service", title: "Service furnace", dueMonths: [10] },
]

// A condo's roof, gutters and usually its central plant belong to the building.
const CONDO_SKIP = new Set(["gutters", "hvac-service", "sprinklers-start", "sprinklers-winterize"])

const LOT: MaintenanceTemplate[] = [
  { key: "property-walk", title: "Walk the property line", description: "Check fences, drainage and markers.", intervalDays: 180 },
]

const VEHICLE_MILES: MaintenanceTemplate[] = [
  { key: "oil", title: "Oil change", intervalDays: 180, intervalMiles: 5000 },
  { key: "tire-rotation", title: "Tire rotation", intervalDays: 180, intervalMiles: 6000 },
  { key: "engine-air-filter", title: "Engine air filter", intervalDays: 365, intervalMiles: 15000 },
  { key: "cabin-air-filter", title: "Cabin air filter", intervalDays: 365, intervalMiles: 15000 },
  { key: "brake-inspection", title: "Brake inspection", intervalDays: 365, intervalMiles: 12000 },
  { key: "registration", title: "Registration renewal", intervalDays: 365 },
]

const VEHICLE_HOURS: MaintenanceTemplate[] = [
  { key: "oil", title: "Oil change", intervalDays: 365, intervalMiles: 100, reminderMilesBefore: 10 },
  { key: "air-filter", title: "Air filter", intervalDays: 365, intervalMiles: 200, reminderMilesBefore: 20 },
  { key: "annual-service", title: "Annual service", intervalDays: 365 },
  { key: "registration", title: "Registration renewal", intervalDays: 365 },
]

const EQUIPMENT: Record<EquipmentCategory, MaintenanceTemplate[]> = {
  APPLIANCE: [
    { key: "clean-inspect", title: "Clean and inspect", description: "Coils, filters, seals and drains.", intervalDays: 365 },
  ],
  HVAC: [
    { key: "filter", title: "Replace filter", intervalDays: 90 },
    { key: "service", title: "Professional service", intervalDays: 365 },
  ],
  WATER: [
    { key: "flush", title: "Flush or descale", intervalDays: 365 },
    { key: "filter", title: "Replace filter", intervalDays: 180 },
  ],
  ELECTRONICS: [
    { key: "dust-update", title: "Dust and check for updates", intervalDays: 180 },
  ],
  TOOL: [
    { key: "inspect", title: "Inspect and lubricate", intervalDays: 365 },
  ],
  OUTDOOR: [
    { key: "season-service", title: "Seasonal service", description: "Oil, blade or chain, spark plug.", intervalDays: 365 },
    { key: "winterize", title: "Winterize", intervalDays: 365 },
  ],
  SECURITY: [
    { key: "test", title: "Test system and batteries", intervalDays: 180 },
  ],
  OTHER: [
    { key: "inspect", title: "Inspect", intervalDays: 365 },
  ],
}

export function templatesFor(asset: TemplateAsset): MaintenanceTemplate[] {
  switch (asset.type) {
    case "PROPERTY":
      if (asset.propertyType === "LOT") return LOT
      if (asset.propertyType === "CONDO") return HOUSE.filter((t) => !CONDO_SKIP.has(t.key))
      return HOUSE
    case "VEHICLE":
      return asset.meterUnit === "HOURS" ? VEHICLE_HOURS : VEHICLE_MILES
    case "EQUIPMENT":
      return EQUIPMENT[asset.category]
  }
}

/**
 * First due point for a new reminder: one interval from today, and one interval
 * past the current reading when it's known. Without a reading only the date
 * side is set; the next completion fills in the meter.
 */
export function firstDue(
  interval: { intervalDays?: number | null; intervalMiles?: number | null; dueMonths?: number[] | null; dueDay?: number | null },
  today: Date,
  currentReading: number | null
): { nextDueDate: Date | null; nextDueMileage: number | null } {
  if (interval.dueMonths?.length) return { nextDueDate: firstCalendarDue(interval.dueMonths, interval.dueDay ?? 1, today), nextDueMileage: null }
  const nextDueDate = interval.intervalDays ? new Date(today.getTime() + interval.intervalDays * 86400000) : null
  const nextDueMileage = interval.intervalMiles && currentReading != null ? currentReading + interval.intervalMiles : null
  return { nextDueDate, nextDueMileage }
}
