import type { FieldHelpMap } from "./types"

export const REMINDER_HELP: FieldHelpMap = {
  "reminder.for": {
    title: "For",
    what: "Whether this reminder belongs to the property itself or to one piece of its equipment.",
    use: "The reminder shows on that item's page. Picking equipment fills in its room when Room is blank, and clears the manual, since a manual belongs to one item.",
  },
  "reminder.title": {
    title: "Title",
    what: "The name of the job, like Oil change or Clean gutters.",
    use: "Shows on the reminder row, in due lists and notifications. When you mark it done and log it, the service record gets this title. Find page looks for it in the manual.",
  },
  "reminder.repeat": {
    title: "Repeats",
    what: "How often this job comes back after you mark it done.",
    use: "Sets the next due date when you complete or skip the reminder. It also decides when the reminder turns up in due-soon lists, the bell and the planned-spend forecast.",
    values: [
      { label: "Every", effect: "Repeats a set number of days (and miles, on a vehicle) after the last time you did it." },
      { label: "On set months", effect: "Comes due in the months you pick, on the day you choose. Good for seasonal jobs like winterizing." },
      { label: "Once", effect: "One-time job. After you complete it, it shows Done and never comes due again." },
    ],
  },
  "reminder.interval-days": {
    title: "Repeat Every (days)",
    what: "How many days after you do the job it comes due again. The links below fill in common gaps.",
    use: "When you mark it done, the next due date is the completion date plus these days. On a vehicle you can leave it blank and repeat by mileage alone.",
  },
  "reminder.interval-miles": {
    title: "Repeat Every (miles)",
    what: "How many miles (or hours, for an hour meter) between jobs. Vehicles only.",
    use: "When you mark it done with a reading, the next due mileage is that reading plus this number. If days are set too, whichever comes first makes it due.",
  },
  "reminder.months": {
    title: "Months",
    what: "The months this job comes due each year. Pick at least one.",
    use: "After you mark it done, it moves to the next picked month. With no due date typed, it starts at the next picked month from today.",
  },
  "reminder.due-day": {
    title: "Day of month",
    what: "The day in each picked month when the job comes due, from 1 to 28. Blank means the 1st.",
  },
  "reminder.estimated-cost": {
    title: "Estimated cost",
    what: "What you expect this job to cost each time you do it.",
    use: "Shows on the reminder row and counts toward planned spend for the next 12 months on the Costs page and the asset's page. Mark complete shows it as a hint in the Cost box.",
  },
  "reminder.next-due-date": {
    title: "Next Due Date",
    what: "When the job is due next.",
    use: "Drives the due-soon and overdue status, the bell and planned spend. Marking it done moves it on by the repeat. On set months, a blank date starts at the next picked month, and a date in another month moves to the next picked one.",
  },
  "reminder.next-due-mileage": {
    title: "Next Due Mileage",
    what: "The odometer reading (or hour count) when the job is due. Vehicles only.",
    use: "Compared with the vehicle's current mileage to show due soon or overdue. Marking it done with a reading sets the next one from the repeat.",
  },
  "reminder.remind-days": {
    title: "Remind (days before)",
    what: "How many days before the due date the reminder counts as due soon. Starts at 14.",
    use: "Due-soon reminders show on the dashboard, in the bell and on the asset's status.",
  },
  "reminder.remind-miles": {
    title: "Remind (miles before)",
    what: "How many miles (or hours) before the due reading the reminder counts as due soon. Starts at 500. Vehicles only.",
    use: "Measured against the vehicle's current mileage, so keep that up to date.",
  },
  "reminder.manual": {
    title: "Manual",
    what: "A file to open when you do this job, like the owner's manual. Choose from files on this item or attached to this reminder.",
    use: "Type a page in the box beside it, or use Find page to search the file for the title. The reminder row and Mark complete then show a Manual link. PDFs open at that page.",
  },
  "reminder.notes": {
    title: "Notes",
    what: "Anything worth remembering about the job, like part numbers, sizes or steps.",
    use: "Shows on the reminder row.",
  },

  "complete.date": {
    title: "Completion Date",
    what: "The day you did the job. Starts at today.",
    use: "The next due date counts from this day. If you add it to the history, the service record gets this date.",
  },
  "complete.mileage": {
    title: "Mileage at Completion",
    what: "The odometer reading (or hours) when you did the job. Starts at the vehicle's current reading.",
    use: "Sets the next due mileage from the repeat. If it's higher than the vehicle's current mileage, that goes up to match.",
  },
  "complete.log": {
    title: "Add to service history",
    what: "Whether to also save this job as a service record. For a person it reads Add to visits.",
    values: [
      { label: "Ticked", effect: "Saves a record with the date, vendor, cost, notes and files below." },
      { label: "Not ticked", effect: "Only marks the reminder done. Nothing is added to the history." },
    ],
  },
  "complete.vendor": {
    title: "Vendor / Shop",
    what: "Who did the work. For a person this reads Facility.",
    use: "Saved on the service record.",
  },
  "complete.cost": {
    title: "Cost",
    what: "What the job cost this time. The grey hint is the reminder's estimate.",
    use: "Saved on the service record and counted in the asset's costs and on the Costs page.",
  },
  "complete.notes": {
    title: "Notes",
    what: "Anything about this job, like parts used or what the shop found.",
    use: "Saved as the service record's description.",
  },
  "complete.files": {
    title: "Receipt or photos",
    what: "Files to keep with this job, like the receipt or a photo of the work.",
    use: "Attached to the new service record.",
  },
}
