/**
 * /search?q=… — the one place the header box and the page agree on. Semantic
 * search is on unless turned off on the results page (&semantic=0).
 */
export function searchHref(q: string, semantic = true) {
  const params = new URLSearchParams({ q })
  if (!semantic) params.set("semantic", "0")
  return `/search?${params.toString()}`
}

/** Whether a /search URL's semantic param leaves semantic search on. */
export const semanticOn = (param: string | null | undefined) => param !== "0"
