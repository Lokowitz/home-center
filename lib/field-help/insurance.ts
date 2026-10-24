import type { FieldHelpMap } from "./types"

export const INSURANCE_HELP: FieldHelpMap = {
  "policy.carrier": {
    title: "Carrier",
    what: "The insurance company.",
    use: "Names the policy on its card, on asset pages and in renewal alerts.",
  },
  "policy.plan": {
    title: "Plan",
    what: "The plan or product name, like Homeowners HO-3 or PPO Gold.",
    use: "Shows after the carrier name.",
  },
  "policy.type": {
    title: "Type",
    what: "The kind of policy.",
    use: "Sets the section it's listed in, what it can cover and which fields show. Health types only appear when Health is on in Settings.",
    values: [
      { label: "Home", effect: "Covers properties or vehicles. Suggests lines like Dwelling and Personal property." },
      { label: "Renters", effect: "Covers properties or vehicles. Suggests lines like Personal property and Loss of use." },
      { label: "Auto", effect: "Covers vehicles or properties. Suggests lines like Collision and Bodily injury." },
      { label: "Umbrella", effect: "Extra liability on top of home and auto. Covers properties or vehicles." },
      { label: "Life", effect: "Listed in its own Life section. Covers people, only when Health is on. Suggests a Death benefit line." },
      { label: "Other", effect: "Any other property or auto policy. Covers properties or vehicles, with no suggested lines." },
      { label: "Medical, Dental or Vision", effect: "Listed under Health. Covers people and adds Member ID, Group number and Out-of-pocket max." },
      { label: "Other (health)", effect: "Same as Medical, for any other health plan." },
    ],
  },
  "policy.number": {
    title: "Policy number",
    what: "The number on your policy papers or insurance card.",
    use: "Shows on the policy card, handy for a claim call.",
  },
  "policy.phone": {
    title: "Phone",
    what: "The carrier's number for claims or questions.",
    use: "Shows on the policy card.",
  },
  "policy.member-phone": {
    title: "Member services phone",
    what: "The member services number, usually on the back of your insurance card.",
    use: "Shows on the policy card.",
  },
  "policy.deductible": {
    title: "Deductible",
    what: "What you pay before the policy starts paying.",
    use: "Shows on the policy card. Each coverage line can also have its own deductible.",
  },
  "policy.term-start": {
    title: "Term starts",
    what: "The first day of the current policy term.",
    use: "Not shown on the card. The renewal date can't be earlier than this.",
  },
  "policy.coverage-start": {
    title: "Coverage starts",
    what: "The day this plan's coverage begins.",
    use: "Shows as the start of the Coverage dates on the card.",
  },
  "policy.renewal": {
    title: "Renewal date",
    what: "The day the current term ends and the policy renews.",
    use: "From 30 days out the card shows Renews in so many days and the bell sends a renewal alert. After the date passes, the card shows Ended.",
  },
  "policy.coverage-end": {
    title: "Coverage ends",
    what: "The last day of coverage, often the end of the plan year.",
    use: "From 60 days out the card shows Ends in so many days and the bell sends an alert. After the date passes, the card shows Ended.",
  },
  "policy.member-id": {
    title: "Member ID",
    what: "Your ID number from the insurance card.",
    use: "Shows on the policy card and next to the plan on each covered person's page.",
  },
  "policy.group": {
    title: "Group number",
    what: "The group number from the insurance card. Employer plans usually have one.",
    use: "Shows on the policy card.",
  },
  "policy.oop-max": {
    title: "Out-of-pocket max",
    what: "The most you pay in a plan year before the plan covers the rest.",
    use: "Shows on the policy card.",
  },
  "policy.covers-people": {
    title: "Covers people",
    what: "Who in the household this policy covers.",
    use: "The policy shows on each person's page.",
  },
  "policy.covers-properties": {
    title: "Covers properties",
    what: "Which properties this policy insures.",
    use: "The policy shows on each property's page. A Personal property line is shown there next to the value of belongings to replace.",
  },
  "policy.covers-vehicles": {
    title: "Covers vehicles",
    what: "Which vehicles this policy insures.",
    use: "The policy shows on each vehicle's page.",
  },
  "policy.coverage": {
    title: "Coverage",
    what: "The policy's coverage lines, each with a name, a limit and its own deductible. Name suggestions depend on the type.",
    use: "Listed on the policy card in this order. A line named Personal property is compared with your belongings on the property page.",
  },
  "policy.notes": {
    title: "Notes",
    what: "Anything else about the policy, like agent details or add-ons.",
    use: "Not shown on the card. Search can find them.",
  },

  // Add premium
  "premium.starts": {
    title: "Starts",
    what: "The date this premium takes effect, usually the start of a term.",
    use: "The newest premium already in effect is the current one. The card compares it with the one before.",
  },
  "premium.amount": {
    title: "Amount",
    what: "What you pay each billing period.",
    use: "The card turns it into a yearly figure.",
  },
  "premium.billed": {
    title: "Billed",
    what: "How often you pay that amount.",
    values: [
      { label: "Yearly", effect: "The amount is the whole year's premium." },
      { label: "Every 6 months", effect: "Doubled for the yearly figure." },
      { label: "Monthly", effect: "Times 12 for the yearly figure." },
    ],
  },
  "premium.notes": {
    title: "Notes",
    what: "A short note, like a new discount or why the rate changed.",
    use: "Shows next to the premium in the list.",
  },
}
