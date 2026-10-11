// Which open reminder a new service record is probably the completion of, so
// the form can offer it ("Oil change" → "Oil change & filter"). Only a
// suggestion: nothing is completed without the user choosing it.

const STOP = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "my", "of", "on", "our", "the", "to", "with"])

/** Words that say nothing about which job it was. */
const GENERIC = new Set(
  ["service", "maintenance", "routine", "annual", "yearly", "monthly", "weekly", "regular", "scheduled", "done", "work"].map(stem)
)

/** Crude, but enough to make "changed"/"change" and "tires"/"tire" meet. */
function stem(word: string): string {
  const cut = word.match(/^(.{3,}?)(ing|ed|es|s|e)$/)
  return cut ? cut[1] : word
}

function keyWords(title: string): Set<string> {
  const words = title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return new Set(words.filter((w) => !STOP.has(w)).map(stem).filter((w) => !GENERIC.has(w)))
}

const within = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w))

/**
 * The reminder whose key words the title covers, or which covers the title's.
 * The one sharing the most words wins; a tie is too unsure to suggest.
 */
export function matchingReminder<R extends { title: string }>(title: string, reminders: R[]): R | null {
  const words = keyWords(title)
  if (!words.size) return null
  const scored = reminders.flatMap((r) => {
    const own = keyWords(r.title)
    if (!own.size || !(within(own, words) || within(words, own))) return []
    return [{ r, score: [...own].filter((w) => words.has(w)).length }]
  })
  if (!scored.length) return null
  const top = Math.max(...scored.map((s) => s.score))
  const best = scored.filter((s) => s.score === top)
  return best.length === 1 ? best[0].r : null
}

/**
 * For a receipt's text: per asset ("TYPE:id"), the one reminder it reads as,
 * so whichever asset it's filed under can offer its match. Assets with no
 * clear match are left out.
 */
export function remindersInText<R extends { id: string; title: string; assetType: string; assetId: string }>(
  text: string,
  reminders: R[]
): Record<string, string> {
  const byAsset = new Map<string, R[]>()
  for (const r of reminders) {
    const key = `${r.assetType}:${r.assetId}`
    byAsset.set(key, [...(byAsset.get(key) ?? []), r])
  }
  const out: Record<string, string> = {}
  for (const [key, list] of byAsset) {
    const hit = matchingReminder(text, list)
    if (hit) out[key] = hit.id
  }
  return out
}
