// Pure helpers for the places outside /intake that point people at it: the
// dashboard card, the empty states, and the one-time tip after a manual record.

/**
 * The dashboard card's numbers: how many items wait for review and the newest
 * few. Items whose upload never landed don't count, same as the sidebar badge.
 */
export function intakeSummary<T extends { createdAt: Date; attachments: unknown[] }>(
  items: T[],
  take = 3
): { count: number; newest: T[] } {
  const landed = items.filter((i) => i.attachments.length > 0)
  const newest = [...landed].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, take)
  return { count: landed.length, newest }
}

export type EmptyStateKind = "records" | "service" | "visits" | "documents"

const EMPTY_COPY: Record<EmptyStateKind, string> = {
  records: "No records yet — add one, or drop a receipt here.",
  service: "No records yet — add one, or drop a receipt here.",
  visits: "No visits yet — add one, or drop a receipt here.",
  documents: "No documents yet — drop a manual or warranty card here, or use Attach file.",
}

export function emptyStateCopy(kind: EmptyStateKind): string {
  return EMPTY_COPY[kind]
}

/** The "drop the receipt next time" tip: only after a new record saved without files, and only once. */
export function receiptTipDue({ isNew, hadFiles, seen }: { isNew: boolean; hadFiles: boolean; seen: boolean }): boolean {
  return isNew && !hadFiles && !seen
}
