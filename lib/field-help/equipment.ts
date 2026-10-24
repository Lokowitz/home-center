import type { FieldHelpMap } from "./types"

export const EQUIPMENT_HELP: FieldHelpMap = {
  "equipment.name": {
    title: "Name",
    what: "What you call this item, like Kitchen refrigerator or Upstairs furnace.",
    use: "Shows in lists, reminders and search. Files dropped into Intake are matched to this item when its name appears in them.",
  },
  "equipment.category": {
    title: "Category",
    what: "The kind of item, like Appliance, HVAC or Water.",
    use: "Picks the default reminders offered for it, and decides what Counts As means when left on Default.",
  },
  "equipment.property": {
    title: "Property",
    what: "The property this item belongs to. Not assigned is fine for things you keep anywhere.",
    use: "The item shows on that property's Equipment tab and in its value totals. The property's rooms are offered as Location suggestions.",
  },
  "equipment.manufacturer": {
    title: "Manufacturer",
    what: "The brand that made it, like LG or Carrier.",
    use: "Together with the model number, used to match files dropped into Intake to this item.",
  },
  "equipment.model-number": {
    title: "Model Number",
    what: "The model number from the label or manual.",
    use: "Files dropped into Intake that mention it are matched to this item.",
  },
  "equipment.serial-number": {
    title: "Serial Number",
    what: "The serial number from the item's label. Handy for warranty claims and service calls.",
    use: "Files dropped into Intake that mention it are matched to this item first.",
  },
  "equipment.location": {
    title: "Location",
    what: "Where the item is, like Kitchen or Garage. Type anything, or pick one of the property's rooms.",
    use: "When the text matches a room name, the item is linked to that room and shows in the room's Equipment tab.",
  },
  "equipment.purchase-date": {
    title: "Purchase Date",
    what: "The day you bought it.",
    use: "Age counts from here when there's no install date. Cost per year owned also starts here.",
  },
  "equipment.install-date": {
    title: "Install Date",
    what: "The day it was put in, if that differs from when you bought it.",
    use: "Age and Expected Life count from this date first. Cost per year owned uses it when there's no purchase date.",
  },
  "equipment.purchase-price": {
    title: "Purchase Price",
    what: "What you paid for it.",
    use: "Added to the item's total owned cost and the property's Paid total. For belongings with no replacement cost, it stands in when compared with your home insurance.",
  },
  "equipment.replacement-cost": {
    title: "Replacement Cost",
    what: "What it would cost to buy a new one today.",
    use: "Adds up in the property's To replace total, is checked against your home insurance for belongings, and becomes the estimated cost when you use Plan replacement.",
  },
  "equipment.expected-life": {
    title: "Expected Life (years)",
    what: "How many years this item should last.",
    use: "The item's page shows its age against this, in amber once it's past. Plan replacement makes the reminder due when the life ends, or a year from today if it already has.",
  },
  "equipment.counts-as": {
    title: "Counts As",
    what: "Whether the item is part of the house or something you'd take with you when you move.",
    use: "Splits the property's value totals in two. The belongings total is compared with your home insurance's personal property cover.",
    values: [
      { label: "Default", effect: "The category decides. HVAC, Water and Security count as part of the home, everything else as belongings." },
      { label: "Part of the home", effect: "Built in, like a furnace or water heater. Kept out of the belongings total." },
      { label: "Belongings", effect: "Things you own, like a TV or mower. Counted in the belongings total." },
    ],
  },
  "equipment.notes": {
    title: "Notes",
    what: "Anything else worth keeping about this item, like filter sizes or who installed it.",
    use: "Shows on the item's page.",
  },
}
