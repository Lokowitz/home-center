// register() runs once per server instance, before the server starts handling
// requests, so it only kicks the scheduler off — the first check is scheduled,
// not awaited, or boot would block on it.
export async function register() {
  // Also evaluated for the edge runtime, which has neither Prisma nor timers
  // that outlive a request.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { startNotificationScheduler } = await import("@/lib/notifications/scheduler")
  startNotificationScheduler()

  const { listenForEntityChanges } = await import("@/lib/search/entities/sync-server")
  listenForEntityChanges()

  const { startDocumentIndexer } = await import("@/lib/documents/indexer-server")
  startDocumentIndexer()

  const { startBackupScheduler } = await import("@/lib/backup/scheduler-server")
  startBackupScheduler()
}
