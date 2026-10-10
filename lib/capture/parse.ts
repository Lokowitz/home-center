// Deterministic receipt reader: date, total and vendor from extracted text.
// Ported from the F6 spike (71% date+total on real receipts). Pure — no I/O.

export type ParsedReceipt = { date: string | null; total: number | null; vendor: string | null }

type FoundDate = { date: string; index: number }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?"
const MON_DAY_YEAR = new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi")
const DAY_MON_YEAR = new RegExp(`\\b(\\d{1,2})[\\s-]${MON}[\\s-,]+(\\d{4}|\\d{2})\\b`, "gi")

const pad = (n: number) => String(n).padStart(2, "0")
const monthOf = (name: string) => MONTHS.indexOf(name.toLowerCase().slice(0, 3)) + 1

function isoDate(y: number, m: number, d: number, maxYear: number): string | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || y < 1990 || y > maxYear) return null
  // Reject impossible days (Feb 30) rather than letting Date roll them over.
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

export function findDates(text: string, maxYear: number): FoundDate[] {
  const out: FoundDate[] = []
  const add = (date: string | null, index: number) => {
    if (date) out.push({ date, index })
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g))
    add(isoDate(+m[3], +m[1], +m[2], maxYear), m.index)
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(isoDate(+m[1], +m[2], +m[3], maxYear), m.index)
  for (const m of text.matchAll(MON_DAY_YEAR)) add(isoDate(+m[3], monthOf(m[1]), +m[2], maxYear), m.index)
  for (const m of text.matchAll(DAY_MON_YEAR)) add(isoDate(+m[3], monthOf(m[2]), +m[1], maxYear), m.index)
  return out.sort((a, b) => a.index - b.index)
}

const DATE_LABEL =
  /(invoice|service|order|repair|transaction|purchase|sale|bill|statement|work|completed|closed)?\s*date|dated|date of service/gi
const NOT_DATE_LABEL = /due|expir|print|next|promis/i

/** True when the text just before a date ends in a "... date" label that is not a due/print/next date. */
function labelled(before: string): boolean {
  const labels = [...before.matchAll(DATE_LABEL)]
  const last = labels.at(-1)
  if (!last) return false
  // Only the label nearest the date counts, with a few words of lead-in — so an
  // earlier "Due Date: …" line no longer vetoes the "Invoice Date:" after it.
  // The lead-in stays on the label's own line: "Amount Due: $64.20" just above
  // "Statement Date:" must not veto it.
  const lead = before.slice(Math.max(0, last.index - 12), last.index + last[0].length)
  return !NOT_DATE_LABEL.test(lead.slice(lead.lastIndexOf("\n") + 1))
}

/** True when the same line, just before the date, says it's a due/print/expiry date ("REPRINT 10/09/2026"). */
function excluded(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1
  return NOT_DATE_LABEL.test(text.slice(Math.max(lineStart, index - 30), index))
}

export function pickDate(text: string, maxYear: number): string | null {
  const dates = findDates(text, maxYear)
  if (!dates.length) return null
  // A date within 40 chars after a "... date" label wins; else the most common
  // (skipping due/print dates unless that's all there is); ties go to the first.
  for (const d of dates) {
    if (labelled(text.slice(Math.max(0, d.index - 40), d.index))) return d.date
  }
  const plain = dates.filter((d) => !excluded(text, d.index))
  const count = new Map<string, number>()
  for (const d of plain.length ? plain : dates) count.set(d.date, (count.get(d.date) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const AMOUNT = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\b/g
const amounts = (s: string) => [...s.matchAll(AMOUNT)].map((m) => Number(m[1].replace(/,/g, "") + "." + m[2]))

const TOTAL_LABEL =
  /\b(grand\s*total|invoice\s*total|total\s*due|amount\s*due|balance\s*due|total\s*amount|amount\s*paid|total\s*paid|total\s*charges|total\s*sale|order\s*total|total)\b/i
const NOT_TOTAL =
  /sub\s*-?\s*total|total\s*(tax|discount|savings|parts|labor|labour|qty|quantity|items?)\b|tax\s*total|due\s*after|paid\s*after|\blate\b/i

export function pickTotal(text: string): number | null {
  const lines = text.split(/\r?\n/)
  const cands: number[] = []
  lines.forEach((line, i) => {
    if (!TOTAL_LABEL.test(line) || NOT_TOTAL.test(line)) return
    const here = amounts(line)
    // Labels and values often land on separate lines in extracted PDFs.
    cands.push(...(here.length ? here : amounts(lines.slice(i + 1, i + 3).join(" "))))
  })
  if (cands.length) return Math.max(...cands)
  const all = amounts(text)
  return all.length ? Math.max(...all) : null
}

export function pickVendor(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /[a-z]{3}/i.test(l) && !/invoice|receipt|page \d|^date/i.test(l))
  return line ? line.slice(0, 60) : null
}

export function parseReceipt(text: string, today: Date = new Date()): ParsedReceipt {
  const maxYear = today.getFullYear() + 1
  return { date: pickDate(text, maxYear), total: pickTotal(text), vendor: pickVendor(text) }
}
