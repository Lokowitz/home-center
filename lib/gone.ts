// Server actions that hit a row someone else already deleted (another tab, a double click).
// Prisma throws P2025 for that; these turn it into a calm result instead of a 500.

export const GONE_MESSAGE = "This was deleted in another tab. Reload to see the current list."

/** True for Prisma's "record to update/delete not found" error, and nothing else. */
export function isRecordGone(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025"
}

/** Runs a write on one row. Returns `{ error }` for the caller to show if the row is gone, nothing otherwise; other errors still throw. */
export async function orGone(write: () => Promise<unknown>): Promise<{ error: string } | undefined> {
  try {
    await write()
  } catch (e) {
    if (isRecordGone(e)) return { error: GONE_MESSAGE }
    throw e
  }
}

/** Runs a delete. A row that's already gone counts as deleted (a repeat click or a second tab). Other errors still throw. */
export async function ignoreGone(write: () => Promise<unknown>): Promise<void> {
  try {
    await write()
  } catch (e) {
    if (!isRecordGone(e)) throw e
  }
}
