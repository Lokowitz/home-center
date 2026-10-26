import type { FieldHelpMap } from "./types"

export const RECORD_HELP: FieldHelpMap = {
  // Service records and visits (also used by "File it" in the Inbox, which makes the same record).
  "service.asset": {
    title: "For",
    what: "The property, vehicle, equipment or person this record belongs to.",
    use: "After you pick, the record form opens with that asset's reminders and details.",
  },
  "service.target": {
    title: "For",
    what: "Whether this record is for the property itself or one of its equipment items.",
    use: "The record shows on that item's page and counts toward its costs. Picking equipment that has a room fills in Room if it's blank.",
  },
  "service.completes-reminder": {
    title: "Completes reminder",
    what: "An open reminder on this asset that this work takes care of. Only offered on a new record.",
    use: "Saving marks the reminder done and sets its next due date from this record's date. On a vehicle, the mileage you enter sets the next due mileage too.",
  },
  "service.date": {
    title: "Date",
    what: "The day the work was done or the visit happened.",
    use: "Places the record in the asset's history and on the costs charts.",
  },
  "service.title": {
    title: "Title",
    what: "A short name for the work, like Oil change or Annual physical.",
    use: "Shows in record lists and search. If it reads like an open reminder, HomeCenter offers to mark that reminder complete.",
  },
  "service.vendor": {
    title: "Vendor / Shop",
    what: "The business that did the work.",
    use: "The costs pages rank your spending by vendor.",
  },
  "service.facility": {
    title: "Facility",
    what: "Where the visit took place, like a clinic or hospital.",
    use: "Counts toward spending by vendor on the costs pages. Left blank, it takes the provider's name.",
  },
  "service.cost": {
    title: "Cost",
    what: "What you paid. A negative amount records a refund.",
    use: "Adds to the asset's totals and the costs charts.",
  },
  "service.category": {
    title: "Category",
    what: "The kind of work, like Routine, Repair or Upgrade. Visits for people use types such as Office visit or Lab.",
    use: "The costs charts split spending by category. Records without one show as Uncategorized.",
  },
  "service.provider": {
    title: "Provider",
    what: "The doctor or practice from your provider list.",
    use: "The Providers page counts visits and spending for each provider. If Facility is blank, it takes the provider's name.",
  },
  "service.condition": {
    title: "For condition",
    what: "The health condition this visit was about.",
    use: "The visit is listed under that condition in the person's Conditions section.",
  },
  "service.mileage": {
    title: "Mileage at Service",
    what: "The odometer reading when the work was done. Vehicles tracked in engine hours ask for hours instead.",
    use: "Used for cost per mile. If the record completes a reminder, it sets the next due mileage and raises the vehicle's reading if it's higher.",
  },
  "service.notes": {
    title: "Notes",
    what: "Anything else worth keeping, like parts used or what the shop found.",
    use: "Shows with the record and search can find it.",
  },

  // Warranties
  "warranty.target": {
    title: "For",
    what: "Whether this warranty covers the property itself or one of its equipment items.",
    use: "The warranty shows on that item's page.",
  },
  "warranty.product": {
    title: "Product / Coverage",
    what: "What the warranty covers, like Roof or Water heater.",
    use: "Names the warranty in lists, on the asset's warranty bar and in expiry alerts.",
  },
  "warranty.vendor": {
    title: "Vendor / Manufacturer",
    what: "The company that backs the warranty.",
    use: "Shows with the warranty as the contact for a claim.",
  },
  "warranty.purchase-date": {
    title: "Purchase Date",
    what: "When you bought the item or the coverage started.",
    use: "With the expiration date, it sets how much of the warranty bar on the asset page is left. Without it, only the days left show.",
  },
  "warranty.expiration": {
    title: "Expiration Date",
    what: "The last day the warranty covers you.",
    use: "The bell alerts you 60 days before. The asset page counts the days left, amber within 90 days and red within 30.",
  },
  "warranty.phone": {
    title: "Vendor Phone",
    what: "The number to call to make a claim.",
    use: "Shows with the warranty and in the asset report.",
  },
  "warranty.email": {
    title: "Vendor Email",
    what: "The address to write to for a claim.",
    use: "Shows with the warranty and in the asset report.",
  },
  "warranty.notes": {
    title: "Notes",
    what: "Terms, claim steps or a registration number.",
    use: "Shows with the warranty in the list.",
  },

  // Inbox
  "inbox.destination": {
    title: "Where it goes",
    what: "What to do with this file once you've checked what was read.",
    use: "HomeCenter picks Add to an existing record when the suggested asset already has a record with the same total and day.",
    values: [
      { label: "New service record", effect: "Opens a form to file it as a new record, filled in from what was read." },
      { label: "Add to an existing record", effect: "Adds the file to a service record or warranty you already entered. The record's details stay as they are." },
      { label: "Keep as a document", effect: "Moves the file to an asset's Documents tab. No record or cost is created." },
    ],
  },
  "inbox.asset": {
    title: "For",
    what: "The asset this receipt is for. HomeCenter fills it in when it can tell from the receipt.",
    use: "The new record goes on that asset. Changing it clears Completes reminder and Category, since those belong to the asset.",
  },
  "inbox.attach-asset": {
    title: "For",
    what: "The asset whose records you want to pick from.",
    use: "The list shows its 25 newest service records and up to 10 warranties.",
  },
  "inbox.attach-record": {
    title: "Record",
    what: "The service record or warranty that gets this file.",
    use: "HomeCenter picks the best match first: the same total, then the same day or within a week. The record's details aren't changed.",
  },
  "inbox.keep-asset": {
    title: "For",
    what: "The asset whose Documents tab gets this file.",
    use: "Good for manuals, titles and warranty cards. No service record is made.",
  },
}
