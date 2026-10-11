// One-time hints shown until the person dismisses them. Dismissal is kept per
// browser (localStorage) by components/tips/use-tip.ts; these are the pure parts.

export const TIP_IDS = ["drop-anywhere-dashboard", "manual-record-receipt", "intake-page-drop-anywhere"] as const
export type TipId = (typeof TIP_IDS)[number]

/** What a dismissed tip's key holds. */
export const TIP_DISMISSED = "dismissed"

export function isTipId(value: unknown): value is TipId {
  return typeof value === "string" && (TIP_IDS as readonly string[]).includes(value)
}

export function tipStorageKey(id: TipId): string {
  return `homecenter.tip.${id}`
}

export function isTipDismissed(stored: string | null): boolean {
  return stored === TIP_DISMISSED
}
