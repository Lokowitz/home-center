import { observationHref } from "@/lib/observations"
import { analyzeObservations, type LogEntry } from "../observation-log"
import {
  all, answerExcludes, answerIncludes, answerIncludesAny, answerMatches, calledTool, either, linksOnly,
  orSearchFirst, type Check,
} from "./checks"
import type { ModelTestCase } from "./types"

// Observations: things the family logs about a person (meltdowns, bad nights).
// Fixtures are built with the real analysis behind observation_log, so their
// shape always matches what the tool returns. Today is 2026-06-15.

const JAMIE = { id: "h-jamie", name: "Jamie", href: "/assets/people/h-jamie" }
const ALEX = { id: "h-alex", name: "Alex", href: "/assets/people/h-alex" }

const entry = (id: string, date: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  id, date: new Date(date), time: null, type: "Meltdown", severity: null, durationMinutes: null,
  notes: null, tags: null, condition: null, person: { id: JAMIE.id, name: JAMIE.name }, ...extra,
})

// Four meltdowns in May (no "4" in any date, time or number, so a "4" in the
// answer can only be the count), two in June, one in March, plus bad nights.
const JAMIE_LOG: LogEntry[] = [
  entry("o-may-02", "2026-05-02", { time: "07:30", severity: 3, durationMinutes: 20, tags: "transition, tired", notes: "Didn't want to leave for school.", condition: { name: "Autism" } }),
  entry("o-may-09", "2026-05-09", { time: "08:15", severity: 2, durationMinutes: 15, tags: "transition", notes: "Shoes felt wrong." }),
  entry("o-may-16", "2026-05-16", { time: "17:00", severity: 5, durationMinutes: 30, tags: "tired, loud place", notes: "After the birthday party." }),
  entry("o-may-27", "2026-05-27", { time: "07:50", severity: 3, durationMinutes: 10, tags: "transition", notes: "Bus was late." }),
  entry("o-jun-01", "2026-06-01", { time: "07:35", severity: 3, durationMinutes: 25, tags: "transition, tired" }),
  entry("o-jun-08", "2026-06-08", { time: "08:05", severity: 2, durationMinutes: 10, tags: "transition" }),
  entry("o-mar-28", "2026-03-28", { time: "19:20", severity: 2, durationMinutes: 15 }),
  entry("o-night-1", "2026-05-12", { type: "Bad night", notes: "Up three times." }),
  entry("o-night-2", "2026-06-03", { type: "Bad night" }),
]

const href = (e: LogEntry) => observationHref(e.person.id, e.id)
const JAMIE_HREFS = [JAMIE.href, ...JAMIE_LOG.map(href)]

/** What observation_log would return for these entries and arguments. */
function logFor(entries: LogEntry[], args: Record<string, unknown> = {}) {
  const type = typeof args.type === "string" ? args.type.trim().toLowerCase() : ""
  const from = typeof args.from === "string" ? args.from : ""
  const to = typeof args.to === "string" ? args.to : ""
  const day = (e: LogEntry) => e.date.toISOString().slice(0, 10)
  const hit = entries.filter((e) => (!type || e.type.toLowerCase().includes(type)) && (!from || day(e) >= from) && (!to || day(e) <= to))
  return {
    asOf: "2026-06-15",
    person: JAMIE,
    ...analyzeObservations(hit, { href, manyPeople: false }),
    ...(hit.length ? {} : { note: "Nothing matched. Types logged: Meltdown, Bad night." }),
  }
}

const JAMIE_SEARCH = { query: "jamie", total: 1, rows: [{ entity: "person", id: JAMIE.id, name: JAMIE.name, href: JAMIE.href }] }

/** find_records or aggregate pointed at observations is a fair alternative to the shortcut. */
const genericOnObservations: Check = (o) => {
  const hit = o.toolCalls.find((c) => ["find_records", "aggregate"].includes(c.name) && String(c.args.entity).toLowerCase().startsWith("observation"))
  return hit
    ? { pass: true, reason: `Asked for observations through ${hit.name}.` }
    : { pass: false, reason: "Expected the observation log (observation_log), but it asked for something else." }
}
const observationLookup = (why?: (a: Record<string, unknown>) => string | null) =>
  orSearchFirst(either(calledTool("observation_log", why), genericOnObservations))

const aboutMeltdowns = (a: Record<string, unknown>) =>
  typeof a.type === "string" && a.type.toLowerCase().includes("meltdown") ? null : "it didn't limit it to meltdowns"

export const OBSERVATION_CASES: ModelTestCase[] = [
  // ---------------------------------------------------------------- tool-choice
  {
    id: "choice-observations-count-in-month",
    stage: "tool-choice",
    category: "Observations",
    title: "Counts logged meltdowns for a month",
    question: "How many meltdowns did Jamie have in May?",
    check: observationLookup(aboutMeltdowns),
  },
  {
    id: "choice-observations-time-of-day",
    stage: "tool-choice",
    category: "Observations",
    title: "Looks at the log for a 'when does it happen' question",
    question: "Do Jamie's meltdowns tend to happen in the morning or the evening?",
    check: observationLookup(),
  },
  {
    id: "choice-observations-not-health-alerts",
    stage: "tool-choice",
    category: "Observations",
    title: "Uses the log, not health reminders, for behaviour notes",
    question: "Show me the notes from the last few bad nights we logged.",
    check: either(calledTool("observation_log"), genericOnObservations),
  },
  {
    id: "choice-observations-draft",
    stage: "tool-choice",
    category: "Observations",
    title: "Drafts an entry when told what happened, estimating severity",
    question: "Jamie was hitting his sister after school today, it went on for about 20 minutes.",
    check: calledTool("draft_observation", (a) => {
      if (!String(a.person ?? "").toLowerCase().includes("jamie")) return "it wasn't for Jamie"
      if (a.durationMinutes !== 20) return "it didn't record 20 minutes"
      if (a.severity === undefined && !(Number(a.severityEstimate) >= 3)) return "it didn't estimate a severity of at least 3 for hitting"
      return null
    }),
  },
  {
    id: "choice-observations-edit",
    stage: "tool-choice",
    category: "Observations",
    title: "Looks up the entry before proposing a change",
    question: "Change Jamie's meltdown on May 12 to a severity 4.",
    check: either(calledTool("observation_log"), calledTool("propose_observation_edit")),
  },
  {
    id: "choice-observations-delete",
    stage: "tool-choice",
    category: "Observations",
    title: "Looks up the entry before proposing a deletion",
    question: "Delete the duplicate meltdown entry for Jamie on May 12.",
    check: either(calledTool("observation_log"), calledTool("propose_observation_delete")),
  },

  // -------------------------------------------------------------------- answer
  {
    id: "answer-observations-count",
    stage: "answer",
    category: "Observations",
    title: "Gives the count from the log",
    question: "How many meltdowns did Jamie have in May?",
    given: [{ name: "observation_log", args: { personId: JAMIE.id, type: "meltdown", from: "2026-05-01", to: "2026-05-31" }, result: logFor(JAMIE_LOG, { type: "meltdown", from: "2026-05-01", to: "2026-05-31" }) }],
    check: all(answerMatches(/\b(4|four)\b/i, "there were 4"), linksOnly(JAMIE_HREFS)),
  },
  {
    id: "answer-observations-pattern",
    stage: "answer",
    category: "Observations",
    title: "Spots the pattern (mornings, transitions)",
    question: "Is there a pattern to Jamie's meltdowns?",
    given: [{ name: "observation_log", args: { personId: JAMIE.id, type: "meltdown" }, result: logFor(JAMIE_LOG, { type: "meltdown" }) }],
    check: all(answerMatches(/morning/i, "that most are in the morning"), answerIncludes(["transition"])),
  },
  {
    id: "answer-observations-none-logged",
    stage: "answer",
    category: "Observations",
    title: "Says so when nothing of that kind was logged",
    question: "Has Jamie had any seizures logged?",
    given: [{ name: "observation_log", args: { personId: JAMIE.id, type: "seizure" }, result: logFor(JAMIE_LOG, { type: "seizure" }) }],
    check: all(
      answerMatches(/\bno\b|none|nothing|not any|haven'?t|hasn'?t|isn'?t|aren'?t/i, "that none are logged"),
      answerExcludes(["severity 5", "seizure on"], "invented a seizure entry")
    ),
  },

  // --------------------------------------------------------------- end-to-end
  {
    id: "e2e-observations-last-month",
    stage: "end-to-end",
    category: "Observations",
    title: "Works out 'last month' and counts meltdowns",
    question: "How many meltdowns did Jamie have last month?",
    fixtures: {
      search: JAMIE_SEARCH,
      observation_log: (args) => logFor(JAMIE_LOG, args),
      find_records: { entity: "observation", total: 0, returned: 0, rows: [], note: "Use observation_log for observations." },
    },
    check: all(calledTool("observation_log"), answerMatches(/\b(4|four)\b/i, "there were 4"), linksOnly(JAMIE_HREFS)),
  },
  {
    id: "e2e-observations-triggers",
    stage: "end-to-end",
    category: "Observations",
    title: "Finds what usually comes before a meltdown",
    question: "What usually seems to set off Jamie's meltdowns?",
    fixtures: { search: JAMIE_SEARCH, observation_log: (args) => logFor(JAMIE_LOG, args) },
    check: all(calledTool("observation_log"), answerIncludes(["transition"]), linksOnly(JAMIE_HREFS)),
  },
  {
    id: "e2e-observations-cant-log",
    stage: "end-to-end",
    category: "Observations",
    title: "Doesn't pretend it logged something",
    question: "Log that Alex had a meltdown at dinner tonight.",
    fixtures: { search: { query: "alex", total: 1, rows: [{ entity: "person", id: ALEX.id, name: ALEX.name, href: ALEX.href }] } },
    check: all(
      answerMatches(/can'?t|cannot|unable|not able|don'?t have (a way|the ability)|only (look|read)|read-only|Log observation/i, "that it can't add entries itself"),
      answerExcludes(["I've logged", "I have logged", "has been logged", "I logged", "I've added", "has been added"], "claimed to have logged it")
    ),
  },
  {
    id: "e2e-observations-severity-trend",
    stage: "end-to-end",
    category: "Observations",
    title: "Reports average severity from the log",
    question: "How severe have Jamie's meltdowns been since May 1?",
    fixtures: { search: JAMIE_SEARCH, observation_log: (args) => logFor(JAMIE_LOG, args) },
    // May 1 on: severities 3, 2, 5, 3, 3, 2 → average 3.
    check: all(calledTool("observation_log"), answerMatches(/\b3(\.0)?\b/, "the average of 3 out of 5"), answerIncludesAny(["5", "five"], "the worst one (5)")),
  },
]
