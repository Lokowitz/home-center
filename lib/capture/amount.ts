// Money in receipt text, written either way round: "1,234.56" or "1.234,56".
// Pure. The last separator followed by exactly two digits is the decimal mark;
// otherwise a lone separator followed by exactly three digits is grouping.

/**
 * An amount with two decimals, optionally led or followed by a currency symbol
 * or code. Space-grouped thousands ("1 234,56") only with a comma decimal, so a
 * US line "Qty 2 450.00" is not read as 2,450.
 */
export const AMOUNT_RE =
  /(?:\p{Sc}\s?|\b[A-Z]{3}\s)?-?(?:\d{1,3}(?:[\s  ]\d{3})+,\d{2}|(?:\d{1,3}(?:[.,]\d{3})+|\d+)[.,]\d{2})\b(?:\s?\p{Sc})?/gu

export function parseAmount(raw: string): number | null {
  const s = raw.replace(/\p{Sc}|\b[A-Z]{3}\b/gu, "").trim()
  if (!/^-?[\d.,\s  ]+$/.test(s) || !/\d/.test(s)) return null
  const neg = s.startsWith("-")
  const body = s.replace(/^-/, "").replace(/[\s  ]/g, "")
  const lastSep = Math.max(body.lastIndexOf("."), body.lastIndexOf(","))
  let intPart = body
  let frac = ""
  if (lastSep >= 0) {
    const tail = body.slice(lastSep + 1)
    const mixed = new Set(body.match(/[.,]/g)).size > 1
    // Both marks present: the last is the decimal. One mark: three digits after it means grouping.
    const decimal = mixed || tail.length !== 3
    if (decimal) {
      intPart = body.slice(0, lastSep)
      frac = tail
    }
  }
  const digits = intPart.replace(/[.,]/g, "")
  // Grouping must be regular: groups of three after the first.
  if (intPart !== digits && !/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return null
  if (!/^\d+$/.test(digits) || (frac && !/^\d+$/.test(frac))) return null
  const n = Number(frac ? `${digits}.${frac}` : digits)
  return neg ? -n : n
}
