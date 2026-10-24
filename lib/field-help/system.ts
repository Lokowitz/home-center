import type { FieldHelpMap } from "./types"

export const SYSTEM_HELP: FieldHelpMap = {
  // Settings → Features. One switch per optional part of the site, for everyone.
  "features.health": {
    title: "Show the Health section",
    what: "Turns the Health part of HomeCenter on or off for everyone: people, providers, health insurance, visits, medications and other health records.",
    use: "Off hides it from the menu, dashboard, lists, search, notifications, the assistant and exports. People and provider pages stop opening. Nothing is deleted, and turning it back on brings it all back.",
  },
  "features.rooms": {
    title: "Show Rooms",
    what: "Turns rooms inside properties on or off for everyone. Rooms hold paint colors, flooring and photos.",
    use: "Off hides the Rooms tab on properties and drops rooms from equipment, records, search and the assistant. Nothing is deleted, and turning it back on brings them back.",
  },
  "features.equipment-tab": {
    title: "Show the Equipment tab on properties and rooms",
    what: "Shows a property's equipment, and each room's, in a tab where you can list and edit it in place.",
    use: "Off removes the tab from properties and from the room window. The equipment itself stays and is still on the Equipment page.",
  },

  // Settings → Regional. Site-wide; labels only, nothing is converted.
  "regional.currency": {
    title: "Currency",
    what: "The currency every amount in HomeCenter is shown in.",
    use: "Sets the symbol and format for costs, prices and totals on every page, in reports and in exports. Amounts you already entered keep their numbers. They are not converted.",
  },
  "regional.distance": {
    title: "Distance",
    what: "Whether vehicle readings are in miles or kilometres.",
    use: "Labels odometer readings, mileage-based reminders and cost per mile or kilometre. Switching only changes the label. Readings you already entered are not converted.",
  },
  "regional.area": {
    title: "Area",
    what: "Whether floor area is in square feet or square metres.",
    use: "Labels the floor area on properties and rooms, in reports and in exports. Switching only changes the label. Sizes you already entered are not converted.",
  },
  "regional.date-format": {
    title: "Date format",
    what: "How dates are written. Each choice shows today's date in that style.",
    use: "Used for every date on the site and in printed reports.",
  },
  "regional.hour12": {
    title: "24-hour clock",
    what: "Shows times as 14:30 instead of 2:30 PM.",
    use: "Used for every time on the site, such as when a backup ran or an observation was logged.",
  },

  // Settings → Appearance. Saved per browser in a cookie.
  "placement.intake": {
    title: "Intake",
    what: "Where the Intake button sits. Intake holds receipts and documents waiting for you to review and file, and the button shows how many.",
    use: "Saved for this browser only. Other devices and other people keep their own choice.",
    values: [
      { label: "Top bar", effect: "An icon with its count beside the notifications bell." },
      { label: "Side menu", effect: "A menu item under Dashboard, with its count." },
    ],
  },
  "placement.assistant": {
    title: "Assistant button",
    what: "Where the button that opens the assistant sits.",
    use: "Saved for this browser only. Other devices and other people keep their own choice.",
    values: [
      { label: "Floating button", effect: "A round button in the bottom-right corner of every page." },
      { label: "Top bar", effect: "An icon in the top bar, beside the notifications bell." },
    ],
  },

  // Settings → Data: backups.
  "backup.protection": {
    title: "Protection",
    what: "How new backup files are locked. Backups you already have keep the protection they were made with.",
    values: [
      { label: "No protection", effect: "A plain zip. Anyone who gets the file can open and read it." },
      { label: "Recovery key", effect: "Locked with a key file you download once. The server can't open them. Lose the key and the backups can't be restored." },
      { label: "Password zip", effect: "Opens in 7-Zip, WinRAR or Keka with your password. The server keeps the password so scheduled backups work." },
    ],
  },
  "backup.key-saved": {
    title: "I saved the key",
    what: "Confirms you stored the recovery key file somewhere other than this server, such as a password manager or a USB stick.",
    use: "Backups made with this key can only be restored with that file. HomeCenter keeps just the public half, so it can't give the key back.",
  },
  "backup.password": {
    title: "Password",
    what: "The password new backups are zipped with. Use at least 6 characters.",
    use: "You type it to open a backup in a zip tool or to restore it here. HomeCenter stores it encrypted so scheduled backups can run.",
  },
  "backup.password-again": {
    title: "Same password again",
    what: "Type the password a second time to catch typos. Save stays off until both match.",
  },
  "backup.schedule": {
    title: "How often",
    what: "How often HomeCenter makes a backup on its own.",
    use: "Backups run in the background at the time you set, using the server's clock.",
    values: [
      { label: "Off", effect: "No automatic backups. You can still make one by hand." },
      { label: "Every day", effect: "One backup a day at the set time." },
      { label: "Every week", effect: "One backup a week, on the day and time you pick." },
    ],
  },
  "backup.day": {
    title: "Day",
    what: "The day of the week the weekly backup runs.",
  },
  "backup.time": {
    title: "Time",
    what: "When the scheduled backup starts, by the server's clock.",
    use: "Pick a quiet time, like overnight. While a backup runs, an export or restore can't start.",
  },
  "backup.folder": {
    title: "Folder",
    what: "Where backup files are saved: a full path inside the container, such as /backups. Leave it empty to use the default.",
    use: "The folder must already exist and be writable. A folder on a different disk or a NAS share keeps your backups safe if the data disk fails.",
  },
  "backup.keep": {
    title: "Keep the newest",
    what: "How many backups to keep, from 1 to 365.",
    use: "After each backup, older backups in the folder beyond this number are deleted. Exports are not counted.",
  },

  // Settings → Data: export.
  "export.scope": {
    title: "What",
    what: "What goes in the export: everything, or a single property, vehicle, piece of equipment or person.",
    use: "Picking a property also brings its equipment. The zip has a page to browse offline, spreadsheets and the files. It can't be restored; use a backup for that.",
  },
  "export.include-health": {
    title: "Include health records",
    what: "Adds people and their health records to an export of everything: visits, medications, conditions, providers and their files.",
    use: "Left unticked, the export has no health data at all. Exporting a single person always includes that person's records.",
  },
  "export.protect": {
    title: "Protect with a password",
    what: "Wraps the export in a password-protected zip. Use at least 6 characters.",
    use: "HomeCenter doesn't keep this password. Send it to the person separately from the file.",
  },
  "export.password": {
    title: "Password",
    what: "The password needed to open this export. Use at least 6 characters.",
    use: "Used for this one export only and not saved anywhere.",
  },
  "export.password-again": {
    title: "Same password again",
    what: "Type the password a second time to catch typos. Create export stays off until both match.",
  },

  // Settings → Data: restore dialog.
  "restore.key": {
    title: "Recovery key (paste it, or choose the kit file)",
    what: "The key for a backup made with Recovery key protection. Paste the line starting AGE-SECRET-KEY, or choose the recovery key file you downloaded.",
    use: "Used once to open the backup and check it. It is not saved.",
  },
  "restore.password": {
    title: "Password",
    what: "The password this backup was zipped with.",
    use: "Used once to open the backup and check it. It is not saved.",
  },
  "restore.confirm": {
    title: "Type RESTORE to continue",
    what: "A check so a restore never happens by accident.",
    use: "Restoring replaces everything in HomeCenter with the backup, signs everyone out and restarts the app. You can undo it for 7 days.",
  },

  // Medical summary report options.
  "report.allergies": {
    title: "Allergies",
    what: "Adds a table of allergies with severity and reaction. Severe ones are printed in capitals.",
  },
  "report.conditions": {
    title: "Conditions",
    what: "Adds the active conditions, with status, start date and provider.",
    use: "Resolved conditions are left out and counted underneath.",
  },
  "report.medications": {
    title: "Medications",
    what: "Adds the medications taken now, with dose, prescriber and start date.",
  },
  "report.immunizations": {
    title: "Immunizations",
    what: "Adds each vaccine with the date given and when the next dose is due.",
  },
  "report.insurance": {
    title: "Insurance",
    what: "Adds this person's insurance: carrier, member ID, group, phone and deductible.",
  },
  "report.care-team": {
    title: "Care team",
    what: "Adds the providers linked to this person, with specialty, practice and phone.",
  },
  "report.review": {
    title: "Medication & behavior review",
    what: "Adds a page with a summary of medications and logged observations: what's taken now, recent changes and how the days went before and after each one.",
  },
  "report.history": {
    title: "Medication history chart",
    what: "Adds a timeline of every medication and dose over time, with the observation days marked.",
  },
  "report.med-list": {
    title: "Medication history",
    what: "Adds a table of every medication with its dose periods and start and end dates.",
  },
  "report.med-list-notes": {
    title: "Include notes",
    what: "Whether medication notes print under their entries in the medication history table.",
    values: [
      { label: "No notes", effect: "Prints the table without notes." },
      { label: "Latest entry only", effect: "Prints the note on each medication's latest entry, if it has one." },
      { label: "Every entry", effect: "Prints every note." },
    ],
  },
  "report.history-range": {
    title: "Medication history range",
    what: "How far back the medication history chart and table go. Medications taken during this period are shown.",
  },
  "report.changes": {
    title: "Medication change observations",
    what: "Adds a chart comparing the average day in the 4 weeks before and after each medication change.",
    use: "Only shows when observations have been logged.",
  },
  "report.obs": {
    title: "Observations",
    what: "Adds logged observations, such as symptoms or moods, from the period you pick. Off leaves them out.",
  },
  "report.obs-view": {
    title: "Chart",
    what: "The chart printed above the observation entries.",
    values: [
      { label: "Heatmap", effect: "A calendar of squares, darker on worse days, with medication changes marked." },
      { label: "Daily severity histogram", effect: "One bar per day, as tall as that day's worst rating." },
      { label: "No chart", effect: "Leaves the chart out." },
    ],
  },
  "report.obs-list": {
    title: "Entry list",
    what: "Adds a table of each observation in the period: when, what, severity and duration.",
  },
  "report.obs-notes": {
    title: "Include notes",
    what: "Adds a notes column, with any tags, to the observation entry list.",
  },
  "report.expense": {
    title: "Medical expense",
    what: "Adds a summary of medical spend to date, number of visits and active conditions.",
  },
  "report.visits": {
    title: "Visits & expenses",
    what: "Adds the list of visits.",
    values: [
      { label: "Off", effect: "Leaves visits out." },
      { label: "On, with cost", effect: "Lists each visit with its cost and a total." },
      { label: "On, no cost", effect: "Lists the visits without any amounts." },
    ],
  },
  "report.reminders": {
    title: "Health reminders",
    what: "Adds this person's reminders, such as checkups, with when each is due.",
  },
}
