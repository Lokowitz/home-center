// An internal link is only trustworthy if a tool returned that exact href during
// this question. Models that skip the lookup copy links from earlier answers or
// invent them — including paths for record types that have no page — and the
// facts around such a link are usually invented too.

const INTERNAL_LINK = /\[([^\]]*)\]\((\/[^)\s]*)\)/g

/** Pages that exist whatever the data; linking them needs no lookup. */
const FIXED_PAGES = new Set([
  "/", "/chat", "/costs", "/maintenance", "/warranties", "/records", "/insurance", "/providers", "/notifications", "/settings", "/inbox",
  "/assets/properties", "/assets/vehicles", "/assets/equipment", "/assets/people",
])

export function unverifiedLinks(text: string, toolOutputs: string[]): string[] {
  const bad = new Set<string>()
  for (const [, , href] of text.matchAll(INTERNAL_LINK)) {
    if (FIXED_PAGES.has(href)) continue
    if (!toolOutputs.some((out) => out.includes(`"${href}"`))) bad.add(href)
  }
  return [...bad]
}

/** A record page that can exist: an asset or person, optionally opening one of its tabs. */
const RECORD_PAGE = /^\/assets\/(properties|vehicles|equipment|people)\/[A-Za-z0-9_-]+(\?[^\s]*)?$/

/** An uploaded file, as the document tools return it: /api/files/<record type>/<id>/<uuid>.<ext>. */
const FILE_LINK = /^\/api\/files\/(service|warranty|maintenance|condition|insurance|observation|medication|allergy|immunization)\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.[a-z0-9]+$/

/**
 * Links whose path can't be any page in the app — /assets/medications/…,
 * /assets/providers?…, /assets/serviceRecords/… — as opposed to a real-looking
 * record link that simply wasn't returned by a tool.
 */
export function impossibleLinks(hrefs: string[]): string[] {
  return hrefs.filter((h) => !FIXED_PAGES.has(h) && !RECORD_PAGE.test(h) && !FILE_LINK.test(h))
}

export function unlink(text: string, hrefs: string[]): string {
  return text.replace(INTERNAL_LINK, (whole, label: string, href: string) => (hrefs.includes(href) ? label : whole))
}
