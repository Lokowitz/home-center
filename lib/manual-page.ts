import { splitPages } from "@/lib/documents/normalize"

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "into", "your", "this", "that"])

function fold(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(fold)
}

export function titleWords(title: string): string[] {
  return [...new Set(words(title))]
}

/// 1-based page that mentions the most distinct title words; the first page wins a tie.
export function findManualPage(text: string, title: string): number | null {
  const wanted = titleWords(title)
  if (wanted.length === 0 || !text) return null
  let best: number | null = null
  let bestCount = 0
  splitPages(text).forEach((page, i) => {
    const present = new Set(words(page))
    const count = wanted.filter((w) => present.has(w)).length
    if (count > bestCount) {
      bestCount = count
      best = i + 1
    }
  })
  return best
}
