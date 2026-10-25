import type { FieldHelpMap } from "./types"

export const HEALTH_HELP: FieldHelpMap = {
  // People
  "person.name": {
    title: "Name",
    what: "The person's name, or your pet's name.",
    use: "Shows on the People list, their health page, search and reminders about their refills and vaccines.",
  },
  "person.relationship": {
    title: "Relationship",
    what: "How this person fits in the household: self, spouse, child, parent, pet or other.",
    use: "Shows as a label on the People list and their page. It doesn't change how anything else works.",
  },
  "person.date-of-birth": {
    title: "Date of birth",
    what: "The day they were born. It can't be in the future.",
    use: "HomeCenter works out their age from it for the People list, their page and the printed summary.",
  },
  "person.sex": {
    title: "Sex",
    what: "Free text, written however you like, such as F or M.",
    use: "Shows on their page and the printed summary when filled in.",
  },
  "person.blood-type": {
    title: "Blood type",
    what: "Their blood type, such as O+ or AB-.",
    use: "Shows on their page and the printed summary when filled in.",
  },
  "person.primary-provider": {
    title: "Primary care provider",
    what: "Their main doctor or clinic, picked from your Providers list.",
    use: "Shows as Primary care on their page and the printed summary, and adds the provider to their care team there.",
  },
  "person.notes": {
    title: "Notes",
    what: "Anything else worth keeping about this person, such as insurance quirks or how to reach them.",
    use: "Shows on their printed summary and is included in search.",
  },
  "person.insurance": {
    title: "Insurance",
    what: "The health and life policies that cover this person.",
    use: "Ticked policies show in the Insurance box on this page and list this person on the Insurance page. Unticking one removes only this person from it.",
  },

  // Providers
  "provider.name": {
    title: "Name",
    what: "The doctor, dentist, therapist or clinic.",
    use: "You pick providers by this name as a primary care provider, a treating provider on a condition and a prescriber on a medication.",
  },
  "provider.specialty": {
    title: "Specialty",
    what: "What they do, such as family medicine or pediatric dentistry.",
    use: "Shows under the name in the Providers list.",
  },
  "provider.practice": {
    title: "Practice",
    what: "The office, group or clinic they work at.",
    use: "Shows in the Practice column of the Providers list.",
  },
  "provider.phone": {
    title: "Phone",
    what: "The number you call to reach them.",
    use: "Shows in the Providers list. Tap it on a phone to call.",
  },
  "provider.email": {
    title: "Email",
    what: "Their email address. It must look like a real address.",
    use: "Shows when you open the provider's row, as a link that starts an email.",
  },
  "provider.address": {
    title: "Address",
    what: "Where the office is.",
    use: "Shows when you open the provider's row.",
  },
  "provider.notes": {
    title: "Notes",
    what: "Anything else about this provider, such as parking, portal logins or who to ask for.",
    use: "Shows when you open the provider's row.",
  },

  // Conditions
  "condition.name": {
    title: "Condition",
    what: "The name of the condition or diagnosis, such as asthma or type 2 diabetes.",
    use: "Shows on the Conditions tab. Medications and observations can be linked to it.",
  },
  "condition.status": {
    title: "Status",
    what: "Where the condition stands now. Pick Resolved to enter the day it cleared up.",
    values: [
      { label: "Active", effect: "Listed first with a red badge. Counted in Active conditions on the People list." },
      { label: "Managed", effect: "Under control. Still counted in Active conditions and kept on the printed summary." },
      { label: "Resolved", effect: "Over. Left out of the active count and the printed summary, but kept in the history." },
    ],
  },
  "condition.provider": {
    title: "Treating provider",
    what: "The doctor who treats this condition, picked from your Providers list.",
    use: "Shows in the Provider column of the Conditions tab.",
  },
  "condition.diagnosed": {
    title: "Diagnosed",
    what: "The day the condition was diagnosed. A rough date is fine if you don't know the exact day.",
    use: "Shows in the Diagnosed column of the Conditions tab.",
  },
  "condition.resolved": {
    title: "Resolved",
    what: "The day the condition cleared up. It can't be before the diagnosed date.",
    use: "Only shows while the status is Resolved. Change the status to anything else and the date is cleared when you save.",
  },
  "condition.notes": {
    title: "Notes",
    what: "Anything else about this condition, such as triggers, test results or what the doctor said.",
    use: "Shows when you open the condition on the Conditions tab.",
  },

  // Medications
  "medication.name": {
    title: "Medication",
    what: "The name of the medicine, such as metformin.",
    use: "Entries with the same name share one row on the Timeline, so a dose change reads as one medicine over time.",
  },
  "medication.dosage": {
    title: "Dosage",
    what: "How much per dose, such as 500 mg.",
    use: "Shows under the name. Write a number and unit so the Timeline and Before & after views can tell a dose went up or down.",
  },
  "medication.frequency": {
    title: "Frequency",
    what: "How often it's taken, such as twice daily or at bedtime.",
    use: "Shows under the name next to the dosage.",
  },
  "medication.prescriber": {
    title: "Prescriber",
    what: "The doctor who prescribed it, picked from your Providers list.",
    use: "Shows in the Prescriber column.",
  },
  "medication.condition": {
    title: "For condition",
    what: "The condition this medicine treats, picked from this person's conditions.",
    use: "Shows in the For column.",
  },
  "medication.started": {
    title: "Started",
    what: "The day they began taking it, or began this dose.",
    use: "Starts the bar on the Timeline and is the day the Before & after view compares around.",
  },
  "medication.stopped": {
    title: "Stopped",
    what: "The last day they took it. Leave it blank while they're still taking it.",
    use: "After this day the medicine moves to Past medications and refill reminders stop.",
  },
  "medication.refill-every": {
    title: "Refill every (days)",
    what: "How many days one fill lasts, as a whole number, such as 30.",
    use: "Adds a Refilled button to the row. Pressing it sets the next refill to this many days from today.",
  },
  "medication.next-refill": {
    title: "Next refill",
    what: "The day the next refill is due.",
    use: "From 7 days before, the row shows Due and a refill reminder appears in the bell. Past the date it shows Overdue.",
  },
  "medication.pharmacy": {
    title: "Pharmacy",
    what: "Where the prescription is filled, so it's handy when you call in a refill.",
  },
  "medication.notes": {
    title: "Notes",
    what: "Anything else about this medicine, such as side effects or why the dose changed.",
    use: "Shows with the medicine's changes in the Before & after view.",
  },

  // Allergies
  "allergy.substance": {
    title: "Substance",
    what: "What they're allergic to, such as penicillin, peanuts or bee stings.",
    use: "Listed in the Allergies box on their page, which is always in view.",
  },
  "allergy.severity": {
    title: "Severity",
    what: "How bad the reaction is.",
    use: "Allergies are listed worst first.",
    values: [
      { label: "Mild", effect: "Listed with a plain badge." },
      { label: "Moderate", effect: "Listed with a gray badge." },
      { label: "Severe", effect: "Turns the Allergies box red and marks the person Severe on the People list." },
    ],
  },
  "allergy.reaction": {
    title: "Reaction",
    what: "What happens when they're exposed, such as hives or swelling.",
    use: "Shows next to the severity in the Allergies box.",
  },
  "allergy.notes": {
    title: "Notes",
    what: "Anything else about this allergy, such as how it was found or what to do if it happens.",
  },

  // Immunizations
  "immunization.vaccine": {
    title: "Vaccine",
    what: "The name of the vaccine, such as Tdap or flu.",
    use: "Use the same name each time. A newer dose with the same name replaces the older one's due date, so it stops reminding you.",
  },
  "immunization.date-given": {
    title: "Date given",
    what: "The day the shot was given.",
    use: "Shows in the Given column. A later date given for the same vaccine marks earlier doses as history.",
  },
  "immunization.next-due": {
    title: "Next due",
    what: "When the next dose or booster is due. It can't be before the date given.",
    use: "From 30 days before, the row shows Due and a vaccine reminder appears in the bell. Past the date it shows Overdue.",
  },
  "immunization.dose": {
    title: "Dose",
    what: "Which dose this was, such as first dose or booster.",
    use: "Shows under the vaccine name.",
  },
  "immunization.given-by": {
    title: "Given by",
    what: "Who gave the shot, such as a doctor's office or pharmacy.",
    use: "Shows in the Given by column.",
  },
  "immunization.notes": {
    title: "Notes",
    what: "Anything else about this shot, such as the lot number or how they felt after.",
  },

  // Observations
  "observation.what-happened": {
    title: "What happened",
    what: "A short name for what you saw, such as meltdown, bad night or headache. Up to 60 characters.",
    use: "Names you've used before are suggested as you type. Reuse them so the filter and counts group the same things together.",
  },
  "observation.date": {
    title: "Date",
    what: "The day it happened. Starts as today.",
    use: "Places the entry in the list, the calendar and the weekly pattern.",
  },
  "observation.time": {
    title: "Time (optional)",
    what: "The time of day it happened, if you know it.",
    use: "Orders entries on the same day and shows next to the date.",
  },
  "observation.severity": {
    title: "How bad (optional)",
    what: "A rating from 1 to 5.",
    use: "Each day on the calendar is rated by its worst entry. Days rated 4 or 5 count as severe days.",
    values: [
      { label: "1 · Mild", effect: "A small thing." },
      { label: "3 · Moderate", effect: "The middle of the scale. 2 and 4 sit in between." },
      { label: "5 · Severe", effect: "As bad as it gets." },
      { label: "Left blank", effect: "Counted as mild, so the day still shows that something happened." },
    ],
  },
  "observation.duration": {
    title: "How long, in minutes (optional)",
    what: "How many minutes it lasted, as a whole number.",
    use: "Shows in the Duration column.",
  },
  "observation.condition": {
    title: "Related condition (optional)",
    what: "The condition this is connected to, picked from this person's conditions.",
    use: "Shows in the Condition column, under the condition on the Conditions tab, and in the filter by condition.",
  },
  "observation.tags": {
    title: "Tags (optional)",
    what: "Short words about the situation, separated by commas, such as school, tired, transition.",
    use: "Shown as badges on the entry. Repeats are dropped. The assistant uses them to spot what keeps coming up.",
  },
  "observation.notes": {
    title: "Notes",
    what: "The details: what led up to it, what helped, anything you want to remember.",
  },
}
