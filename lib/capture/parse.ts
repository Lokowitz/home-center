// Deterministic receipt reader: date, total and vendor from extracted text.
// Ported from the F6 spike (71% date+total on real receipts). Pure — no I/O.
import { looksLikeHouseholdName } from "@/lib/inbox-form"
import { AMOUNT_RE, parseAmount } from "./amount"

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
  /(invoice|service|order|repair|transaction|purchase|sale|bill|statement|work|completed|closed|collection|procedure|visit)?\s*date|dated|date of (service|visit)|collected( on)?/gi
const NOT_DATE_LABEL = /due|expir|print|next|promis|birth|\bdob\b|born/i
// What a date of birth is called between its label and the date ("Date of Birth: ").
const BIRTH = /birth|\bdob\b|born/i
// A browser's print header or footer: "10/20/23, 7:10 AM" — when the page was printed.
const PRINT_STAMP = /^[\d/.-]+,\s*\d{1,2}:\d{2}\s*[ap]\.?m\b/i

/** True when the text just before a date ends in a "... date" label that is not a due/print/next date. */
function labelled(before: string): boolean {
  const labels = [...before.matchAll(DATE_LABEL)]
  const last = labels.at(-1)
  if (!last) return false
  // "Date of Birth:" — the label is "Date", what follows says whose.
  if (BIRTH.test(before.slice(last.index))) return false
  // Only the label nearest the date counts, with a few words of lead-in — so an
  // earlier "Due Date: …" line no longer vetoes the "Invoice Date:" after it.
  // The lead-in stays on the label's own line: "Amount Due: $64.20" just above
  // "Statement Date:" must not veto it.
  const lead = before.slice(Math.max(0, last.index - 12), last.index + last[0].length)
  return !NOT_DATE_LABEL.test(lead.slice(lead.lastIndexOf("\n") + 1))
}

/**
 * True when the date is a due/print/expiry date or a date of birth, by the same
 * line just before it ("REPRINT 10/09/2026", "DOB: 1/2/80"), or a print stamp.
 */
function excluded(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1
  return NOT_DATE_LABEL.test(text.slice(Math.max(lineStart, index - 30), index)) || PRINT_STAMP.test(text.slice(index, index + 30))
}

export function pickDate(text: string, maxYear: number): string | null {
  const dates = findDates(text, maxYear)
  if (!dates.length) return null
  // A date within 40 chars after a "... date" label wins; else the most common
  // (skipping due/print dates unless that's all there is); ties go to the first.
  for (const d of dates) {
    if (labelled(text.slice(Math.max(0, d.index - 40), d.index)) && !excluded(text, d.index)) return d.date
  }
  const plain = dates.filter((d) => !excluded(text, d.index))
  const count = new Map<string, number>()
  for (const d of plain.length ? plain : dates) count.set(d.date, (count.get(d.date) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

// Magnitudes: a refund line "-96.29" counts as 96.29 (see the fixtures convention).
const amounts = (s: string) =>
  [...s.matchAll(AMOUNT_RE)].map((m) => parseAmount(m[0])).filter((n): n is number => n != null).map(Math.abs)

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

// A reference number line: "Job #188200417", "Order Number: QX55120847", "PO# 5510".
const ID_LINE =
  /^(job|order|ref|reference|po|p\.o\.|purchase order|work order|repair order|ro|account|acct|ticket|transaction|trans|txn|confirmation|conf|customer|cust|member|tracking|store|register|reg|terminal|auth|approval|case|claim)\b\.?\s*(#|no\b\.?|num\b\.?|number|id)?\s*[:#]?\s*[a-z]{0,4}[-\s]?\d/i
// What a date line is made of besides digits and punctuation.
const DATE_WORDS =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|(mon|tues?|wed(nes)?|thu(rs?)?|fri|sat(ur)?|sun)(day)?|[ap]\.?m)\b\.?/gi
const CONTACT = /https?:\/\/|\bwww\.|\S+@\S+\.\S+|^(tel|phone|ph|fax|call)\b/i
// OCR noise and decoration at the ends of a line (">. BELLE", "** NAME --"). A
// trailing period stays: "Allbright Plumbing Co.".
const trimNoise = (l: string) => l.trim().replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}.)'&]+$/u, "")

// "Name: …", "Issued date:Tue …", "Order Total: $9" — a field label, not a name.
const LABEL_LINE = /^[\p{L}][\p{L} .'/]{0,24}:/u
// A line that is only a document title or section heading.
const HEADING =
  /^(recipient|estimate|quote|quotation|proposal|warning|notice|summary|order summary|statement|report|inspection report|work order|description|notes?|bill to|ship to|sold to|customer|patient|results?)$/i
const GREETING = /^(hi|hello|hey|dear|thanks?|thank you|we appreciate)\b/i
const TABLE_WORDS = /\b(item|description|qty|quantity|price|amount|unit|rate|hours|total)\b/gi
// A price, with or without a currency sign: an item line, not a name.
const MONEY = /\p{Sc}\s?\d|\b\d+[.,]\d{2}\b/u
const STREET =
  /^\d+[\w-]*\s+(?:[\p{L}.]+\s+){0,4}(rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|hwy|highway|way|pkwy|parkway|pl|place|cir|circle|ter|terrace|trl|trail)\b\.?/iu
const PO_BOX = /\bp\.?\s?o\.?\s?box\b/i
// "Dexter, MI 48130", "DEXTER, MI 48130-8620 USA", and a country on its own.
const CITY_LINE = /^[\p{L} .'-]+,\s*[a-z]{2}\.?\s+\d{5}(-\d{4})?\b/iu
const COUNTRY = /^(usa|u\.s\.a\.?|united states( of america)?|canada)$/i
// "Due date", "ESTIMATE DATE": a column heading.
const DATE_HEADING = /\bdate$/i
// An email's sender: "AutoZone <orders@em.autozone.com>".
const SENDER = /^([^<>@\n]{3,40}?)\s*<[^<>\s@]+@[^<>\s]+>/
// The shop's own address: an email or web domain that isn't free mail.
const DOMAIN = /(?:@|\bwww\.|https?:\/\/)([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|comcast|att|verizon|proton|protonmail|gmx|mail)\./i
const DOMAIN_SCAN_LINES = 15
// The lines after "Bill To" are the customer's name and address.
const CUSTOMER_LABEL = /^(bill(ed)?\s*to|sold\s*to|ship\s*to|customer|client|patient)\b/i
const CUSTOMER_LINES = 3
// A company suffix ending the line says it names a business. Trade words
// ("Service", "Repair") don't: item lines are full of them.
const BUSINESS = /\b(llc|l\.l\.c|inc|co|corp|corporation|company|ltd)\.?$/i
// Only this far down the page does a business-sounding line beat the first plausible one.
const BUSINESS_SCAN_LINES = 60

/** OCR soup: most "words" are one or two characters ("g ro u p @@@3 h 1 tt4"). */
function letterSoup(l: string): boolean {
  const words = l.split(/\s+/).filter(Boolean)
  return words.length >= 5 && words.filter((w) => w.length <= 2).length / words.length >= 0.6
}

function isVendorLine(l: string, householdNames: string[]): boolean {
  if (!/[a-z]{3}/i.test(l)) return false
  if (/invoice|receipt|page \d|^date/i.test(l)) return false
  if (ID_LINE.test(l) || CONTACT.test(l)) return false
  const digits = (l.match(/\d/g) ?? []).length
  const letters = (l.match(/\p{L}/gu) ?? []).length
  if (digits >= letters) return false
  // A date line: nothing left but digits and punctuation once month, weekday and am/pm words go.
  if (/\d/.test(l) && !/[a-z]{3}/i.test(l.replace(DATE_WORDS, ""))) return false
  if (LABEL_LINE.test(l) || HEADING.test(l) || GREETING.test(l) || MONEY.test(l)) return false
  if ((l.match(TABLE_WORDS) ?? []).length >= 2) return false
  if (STREET.test(l) || PO_BOX.test(l) || CITY_LINE.test(l) || COUNTRY.test(l) || DATE_HEADING.test(l) || letterSoup(l)) return false
  if (looksLikeHouseholdName(l, householdNames)) return false
  return true
}

/** The registrable part of a domain: "em.autozone.com" → "autozone.com". */
const baseDomain = (d: string) => d.toLowerCase().split(".").slice(-2).join(".")
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** The first business email or web domain near the top, not free mail. */
function shopDomain(lines: string[]): string | null {
  for (const line of lines.slice(0, DOMAIN_SCAN_LINES)) {
    for (const m of line.matchAll(DOMAIN)) {
      const d = baseDomain(m[1])
      if (!FREE_MAIL.test(d)) return d
    }
  }
  return null
}

/**
 * The shop's name, best evidence first: an email's sender name; a line ending
 * in a company suffix (LLC, Inc, Co) near the top; a line that matches the
 * shop's email or web domain; that domain itself, when no line names the shop
 * (a logo the text extraction can't read); else the first plausible line.
 * OCR noise at a line's ends is trimmed; lines just after "Bill To" are skipped.
 */
export function pickVendor(text: string, householdNames: string[] = []): string | null {
  const raw = text.split(/\r?\n/)
  for (const line of raw.slice(0, DOMAIN_SCAN_LINES)) {
    const sender = SENDER.exec(line.trim())?.[1]?.replace(/^["']|["']$/g, "").trim()
    if (sender && /[a-z]{3}/i.test(sender) && !looksLikeHouseholdName(sender, householdNames)) return sender.slice(0, 60)
  }
  const lines = raw.map(trimNoise)
  const candidates: { line: string; at: number }[] = []
  let customerUntil = -1
  lines.forEach((line, i) => {
    if (CUSTOMER_LABEL.test(line)) customerUntil = i + CUSTOMER_LINES
    else if (i > customerUntil && isVendorLine(line, householdNames)) candidates.push({ line, at: i })
  })
  const domain = shopDomain(lines)
  const domainWord = domain ? squash(domain.split(".")[0]) : ""
  const pick =
    candidates.find((c) => c.at < BUSINESS_SCAN_LINES && BUSINESS.test(c.line)) ??
    (domainWord.length >= 3 ? candidates.find((c) => matchesDomain(c.line, domainWord)) : undefined)
  if (pick) return pick.line.slice(0, 60)
  if (domain) return domain
  return candidates[0] ? candidates[0].line.slice(0, 60) : null
}

/** "Ace Hardware" for acehardware, "Haley Mechanical" for haleymechanical: the line's first word starts the domain. */
function matchesDomain(line: string, domainWord: string): boolean {
  const first = squash(line.split(/\s+/)[0] ?? "")
  return first.length >= 3 && domainWord.startsWith(first)
}

export type ParseOptions = { householdNames?: string[] }

export function parseReceipt(text: string, today: Date = new Date(), opts: ParseOptions = {}): ParsedReceipt {
  const maxYear = today.getFullYear() + 1
  return { date: pickDate(text, maxYear), total: pickTotal(text), vendor: pickVendor(text, opts.householdNames) }
}
