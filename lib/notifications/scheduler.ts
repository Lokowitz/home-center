import { checkAndNotify } from "./checker"
import { nudgeIntake } from "./intake-nudge-server"
import { sendPendingDigests } from "./digest"
import { pruneOldNotifications } from "./retention"

// Notifications used to be created by a fire-and-forget call on the dashboard,
// which meant they only appeared when somebody happened to look — no visit, no
// reminder, however overdue. This runs the check on a timer instead, so it
// happens whether or not anyone is watching.
//
// HomeCenter ships as a single container against a single SQLite file, so an
// interval in the server process is the whole scheduler: there is exactly one
// long-lived process, and nothing external to configure. Run several replicas
// and each would run its own pass; the dedup check in checkAndNotify keeps that
// from duplicating notifications, but this is not a distributed lock.

const DEFAULT_INTERVAL_MINUTES = 360 // 6 hours
// Long enough to stay clear of the server's own startup work.
const BOOT_DELAY_MS = 15_000

function intervalMs() {
  const raw = process.env.NOTIFY_INTERVAL_MINUTES
  if (raw === undefined) return DEFAULT_INTERVAL_MINUTES * 60_000
  const minutes = Number(raw)
  if (!Number.isFinite(minutes) || minutes < 0) {
    console.warn(`[notifications] ignoring invalid NOTIFY_INTERVAL_MINUTES=${raw}`)
    return DEFAULT_INTERVAL_MINUTES * 60_000
  }
  return minutes * 60_000 // 0 disables
}

// Guarantees runs never overlap. Two passes at once would both read "no
// existing notification" before either wrote one, and both would then write.
let running = false

async function runOnce(trigger: string) {
  if (running) {
    console.warn(`[notifications] ${trigger} skipped — previous run still in progress`)
    return
  }
  running = true
  const startedAt = Date.now()
  try {
    const created = (await checkAndNotify()) + (await nudgeIntake())
    // Runs every pass, not just when something was created: a digest the user
    // wasn't due for last time may be due now, and a failed send needs a retry.
    const emailed = await sendPendingDigests()
    const pruned = await pruneOldNotifications()
    if (created > 0 || emailed > 0 || pruned > 0) {
      console.log(
        `[notifications] ${trigger}: created ${created}, emailed ${emailed}, deleted ${pruned} older than a year in ${Date.now() - startedAt}ms`
      )
    }
  } catch (error) {
    // Logged rather than swallowed: a checker that silently stops notifying
    // looks exactly like having nothing due.
    console.error(`[notifications] ${trigger} failed:`, error)
  } finally {
    running = false
  }
}

let started = false

export function startNotificationScheduler() {
  // register() can fire more than once in dev as the server reloads.
  if (started) return
  started = true

  const every = intervalMs()
  if (every === 0) {
    console.log("[notifications] scheduler disabled (NOTIFY_INTERVAL_MINUTES=0)")
    return
  }

  // Catches anything that came due while the container was down.
  setTimeout(() => void runOnce("boot check"), BOOT_DELAY_MS).unref()

  // unref so a pending timer never keeps the process alive on shutdown.
  setInterval(() => void runOnce("scheduled check"), every).unref()

  console.log(`[notifications] scheduler started — every ${every / 60_000} minute(s)`)
}
