import type { CheckResult, Outcome } from "./types"

// Building blocks for model-test cases. Every result carries a one-line reason
// written for someone who isn't a developer.

export type Check = (o: Outcome) => CheckResult

const TOOL_WORDS: Record<string, string> = {
  search: "a name search",
  cost_summary: "a spending summary",
  asset_history: "an item's history",
  maintenance_status: "maintenance status",
  warranty_status: "warranty status",
  health_alerts: "health reminders",
  observation_log: "the observation log",
  inbox: "the Inbox",
  find_records: "a list of records",
  get_record: "one record's details",
  aggregate: "a count or total",
}
export const describeTool = (name: string) => `${TOOL_WORDS[name] ?? "a lookup"} (${name})`

const norm = (s: string) =>
  s.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/[*_`]/g, "").replace(/\s+/g, " ")
export const mentions = (answer: string, value: string | number) => norm(answer).includes(norm(String(value)))

/** $2,340 and $2,340.00 are the same answer. */
export function moneyForms(n: number): string[] {
  return Number.isInteger(n) ? [n.toFixed(2), String(n)] : [n.toFixed(2)]
}

/**
 * The model called `name` (in any round). `args` returns null when the
 * arguments are fine, or a plain reason when they aren't.
 */
export function calledTool(name: string, args?: (a: Record<string, unknown>) => string | null): Check {
  return (o) => {
    const calls = o.toolCalls.filter((c) => c.name === name)
    if (!calls.length) {
      const got = o.toolCalls.length
        ? `it asked for ${[...new Set(o.toolCalls.map((c) => describeTool(c.name)))].join(", ")}`
        : "it answered without looking anything up"
      return { pass: false, reason: `Expected ${describeTool(name)}, but ${got}.` }
    }
    if (args) {
      const problems = calls.map((c) => args(c.args))
      if (problems.every((p) => p !== null)) return { pass: false, reason: `Asked for ${describeTool(name)}, but ${problems[0]}.` }
    }
    return { pass: true, reason: `Asked for ${describeTool(name)}.` }
  }
}

/** Any one of several reasonable tools. */
export function calledOneOf(names: string[]): Check {
  return (o) => {
    const hit = o.toolCalls.find((c) => names.includes(c.name))
    if (hit) return { pass: true, reason: `Asked for ${describeTool(hit.name)}.` }
    const got = o.toolCalls.length ? `it asked for ${describeTool(o.toolCalls[0].name)}` : "it answered without looking anything up"
    return { pass: false, reason: `Expected ${names.map(describeTool).join(" or ")}, but ${got}.` }
  }
}

export function calledNoTool(): Check {
  return (o) =>
    o.toolCalls.length
      ? { pass: false, reason: `Should have answered without a lookup, but it asked for ${describeTool(o.toolCalls[0].name)}.` }
      : { pass: true, reason: "Answered without a lookup, as it should." }
}

export function notCalled(name: string, why: string): Check {
  return (o) =>
    o.toolCalls.some((c) => c.name === name)
      ? { pass: false, reason: `It asked for ${describeTool(name)} — ${why}.` }
      : { pass: true, reason: `Didn't use ${describeTool(name)}.` }
}

export function answerIncludes(values: (string | number)[]): Check {
  return (o) => {
    const missing = values.filter((v) => !mentions(o.answer, v))
    return missing.length
      ? { pass: false, reason: `Missing: ${missing.join(", ")}.` }
      : { pass: true, reason: `Mentions ${values.map((v) => norm(String(v))).join(", ")}.` }
  }
}

/** At least one of several acceptable phrasings or number formats. */
export function answerIncludesAny(values: (string | number)[], what?: string): Check {
  return (o) =>
    values.some((v) => mentions(o.answer, v))
      ? { pass: true, reason: `Mentions ${what ?? values[0]}.` }
      : { pass: false, reason: `Missing ${what ?? values.join(" / ")}.` }
}

export function answerExcludes(values: string[], why: string): Check {
  return (o) => {
    const found = values.find((v) => mentions(o.answer, v))
    return found ? { pass: false, reason: `Found “${found}” — ${why}.` } : { pass: true, reason: "Nothing made up." }
  }
}

export function answerMatches(pattern: RegExp, what: string): Check {
  return (o) => (pattern.test(o.answer) ? { pass: true, reason: `Says ${what}.` } : { pass: false, reason: `Doesn't say ${what}.` })
}

const REFUSAL = /can'?t|cannot|don'?t have|do not have|no access|not able|unable|not available|isn'?t something|not something I/i
export function refuses(): Check {
  return (o) =>
    REFUSAL.test(o.answer)
      ? { pass: true, reason: "Declined, as it should." }
      : { pass: false, reason: "Should have declined, but didn't." }
}

/** Every internal link must be one the data provided. */
export function linksOnly(allowed: string[]): Check {
  return (o) => {
    const bad = [...o.answer.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]).filter((h) => !allowed.includes(h))
    return bad.length
      ? { pass: false, reason: `Made-up link: ${[...new Set(bad)].join(", ")}.` }
      : { pass: true, reason: "Links are all from the data." }
  }
}

export function shortAnswer(max: number): Check {
  return (o) =>
    o.answer.length <= max
      ? { pass: true, reason: "Kept it short." }
      : { pass: false, reason: `Too long for the question: ${o.answer.length} characters (limit ${max}).` }
}

/** Every check must pass. Reports every pass reason, or the first failure. */
export function all(...checks: Check[]): Check {
  return (o) => {
    const results = checks.map((c) => c(o))
    const failed = results.find((r) => !r.pass)
    return failed ?? { pass: true, reason: results.map((r) => r.reason).join(" ") }
  }
}

/** Either check may pass — for questions with two reasonable first steps. Fails with the first check's reason. */
export function either(first: Check, second: Check): Check {
  return (o) => {
    const a = first(o)
    if (a.pass) return a
    const b = second(o)
    return b.pass ? b : a
  }
}

/** A name search first is a fair opening move when the question names an item. */
export const orSearchFirst = (check: Check): Check =>
  either(check, (o) =>
    o.toolCalls[0]?.name === "search"
      ? { pass: true, reason: `Looked the item up by name first (${describeTool("search")}).` }
      : { pass: false, reason: "" }
  )
