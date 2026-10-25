import { checkAndNotify } from "./checker"
import { nudgeIntake } from "./intake-nudge-server"
import { sendPendingDigests } from "./digest"
import { pruneOldNotifications } from "./retention"
import { sendPendingPush } from "./push"
import { loadNotificationConfig } from "./notification-settings"

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

// Long enough to stay clear of the server's own startup work.
const BOOT_DELAY_MS = 15_000

// The timer is shared through globalThis: the settings action that changes the
// interval can run in a different loaded copy of this module than the one
// instrumentation started, and it has to reach the same timer.
const g = globalThis as unknown as { __hcNotifyStarted?: boolean; __hcNotifyTimer?: ReturnType<typeof setInterval>; __hcNotifyRunning?: boolean }

// Guarantees runs never overlap. Two passes at once would both read "no
// existing notification" before either wrote one, and both would then write.
// On globalThis for the same reason as the timer: any loaded copy may start a pass.

async function runOnce(trigger: string) {
  if (g.__hcNotifyRunning) {
    console.warn(`[notifications] ${trigger} skipped — previous run still in progress`)
    return
  }
  g.__hcNotifyRunning = true
  const startedAt = Date.now()
  try {
    const created = (await checkAndNotify()) + (await nudgeIntake())
    // Runs every pass, not just when something was created: a digest the user
    // wasn't due for last time may be due now, and a failed send needs a retry.
    const emailed = await sendPendingDigests()
    const pushed = await sendPendingPush()
    const pruned = await pruneOldNotifications()
    if (created > 0 || emailed > 0 || pushed > 0 || pruned > 0) {
      console.log(
        `[notifications] ${trigger}: created ${created}, emailed ${emailed}, pushed ${pushed}, deleted ${pruned} older than a year in ${Date.now() - startedAt}ms`
      )
    }
  } catch (error) {
    // Logged rather than swallowed: a checker that silently stops notifying
    // looks exactly like having nothing due.
    console.error(`[notifications] ${trigger} failed:`, error)
  } finally {
    g.__hcNotifyRunning = false
  }
}

/**
 * Starts, restarts or stops the timer to match the interval in effect. Called at
 * boot and again whenever an admin saves a new interval, so no restart is needed.
 */
export async function applyNotificationInterval() {
  if (g.__hcNotifyTimer) clearInterval(g.__hcNotifyTimer)
  g.__hcNotifyTimer = undefined

  const { interval } = await loadNotificationConfig()
  if (interval.minutes === 0) {
    console.log("[notifications] scheduler off (interval is 0)")
    return 0
  }

  // unref so a pending timer never keeps the process alive on shutdown.
  g.__hcNotifyTimer = setInterval(() => void runOnce("scheduled check"), interval.minutes * 60_000)
  g.__hcNotifyTimer.unref()
  console.log(`[notifications] scheduler running — every ${interval.minutes} minute(s)`)
  return interval.minutes
}

export function startNotificationScheduler() {
  // register() can fire more than once in dev as the server reloads.
  if (g.__hcNotifyStarted) return
  g.__hcNotifyStarted = true

  void applyNotificationInterval()
    .then((minutes) => {
      // Catches anything that came due while the container was down. Skipped when
      // the interval is 0, which turns the checks off entirely.
      if (minutes > 0) setTimeout(() => void runOnce("boot check"), BOOT_DELAY_MS).unref()
    })
    .catch((e) => console.error("[notifications] couldn't start the scheduler:", e))
}
