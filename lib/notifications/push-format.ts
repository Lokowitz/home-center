// What goes out to the push endpoint. Pure so grouping, trimming and each
// service's request shape can be tested without a database or the network.

export type PushType = "DISCORD" | "NTFY" | "TELEGRAM" | "JSON"

export const PUSH_TYPES: { value: PushType; label: string }[] = [
  { value: "DISCORD", label: "Discord webhook" },
  { value: "NTFY", label: "ntfy" },
  { value: "TELEGRAM", label: "Telegram bot" },
  { value: "JSON", label: "Generic JSON webhook" },
]

export const isPushType = (v: string): v is PushType => PUSH_TYPES.some((t) => t.value === v)

/** The notification fields push needs. */
export type PushRow = {
  id: string
  type: string
  title: string
  message: string
  relatedEntityId: string | null
  cycleKey: string | null
  stage: string | null
}

export type PushItem = { type: string; title: string; message: string }

/**
 * One item per due thing, however many people have a row for it. Every recipient
 * gets their own notification row, so three users would otherwise mean three
 * messages about the same boiler on a shared channel. Rows with no related
 * entity (custom ones) are never merged.
 */
export function groupForPush(rows: PushRow[]): { items: PushItem[]; rowIds: string[] } {
  const seen = new Map<string, PushItem>()
  for (const r of rows) {
    const key = r.relatedEntityId ? [r.type, r.relatedEntityId, r.cycleKey ?? "", r.stage ?? ""].join("|") : `row:${r.id}`
    if (!seen.has(key)) seen.set(key, { type: r.type, title: r.title, message: r.message })
  }
  return { items: [...seen.values()], rowIds: rows.map((r) => r.id) }
}

// Per-service message limits, kept under the real ones.
const LIMITS: Record<PushType, number> = { DISCORD: 1900, NTFY: 3500, TELEGRAM: 4000, JSON: Infinity }

/** The message body: a heading, one entry per item, a link, trimmed to fit. */
export function renderPushText(items: PushItem[], publicUrl: string | null, limit: number): string {
  const heading = items.length === 1 ? "HomeCenter: 1 item needs attention" : `HomeCenter: ${items.length} items need attention`
  const footer = publicUrl ? `\n\nSee everything: ${publicUrl}/notifications` : ""
  const entries = items.map((i) => `- ${i.title}\n  ${i.message}`)

  // Drop whole entries from the end rather than cutting one in half.
  for (let shown = entries.length; shown >= 0; shown--) {
    const more = entries.length - shown
    const body = [heading, "", ...entries.slice(0, shown), ...(more ? [`+${more} more`] : [])].join("\n") + footer
    if (body.length <= limit) return body
  }
  // Even the heading plus footer didn't fit, which a real limit never allows.
  return heading.slice(0, limit)
}

export type PushTarget = {
  type: PushType
  /** Webhook URL. For Telegram this is unused: the URL is built from the token. */
  url: string | null
  token: string | null
  chatId: string | null
}

export type PushRequest = { url: string; init: { method: "POST"; headers: Record<string, string>; body: string } }

/** The HTTP request for a target, or null when the target lacks what its type needs. */
export function buildPushRequest(target: PushTarget, items: PushItem[], publicUrl: string | null): PushRequest | null {
  const text = renderPushText(items, publicUrl, LIMITS[target.type])
  const json: Record<string, string> = { "Content-Type": "application/json" }
  const bearer: Record<string, string> = target.token ? { Authorization: `Bearer ${target.token}` } : {}

  switch (target.type) {
    case "DISCORD":
      if (!target.url) return null
      // allowed_mentions off, so a title containing @everyone can't ping the server.
      return { url: target.url, init: { method: "POST", headers: json, body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }) } }
    case "NTFY":
      if (!target.url) return null
      return {
        url: target.url,
        init: {
          method: "POST",
          // Header values must be plain ASCII, so the title stays fixed.
          headers: { Title: "HomeCenter", ...(publicUrl ? { Click: `${publicUrl}/notifications` } : {}), ...bearer },
          body: text,
        },
      }
    case "TELEGRAM":
      if (!target.token || !target.chatId) return null
      return {
        url: `https://api.telegram.org/bot${target.token}/sendMessage`,
        init: { method: "POST", headers: json, body: JSON.stringify({ chat_id: target.chatId, text, disable_web_page_preview: true }) },
      }
    case "JSON":
      if (!target.url) return null
      return {
        url: target.url,
        init: {
          method: "POST",
          headers: { ...json, ...bearer },
          body: JSON.stringify({ source: "homecenter", count: items.length, text, items, url: publicUrl ? `${publicUrl}/notifications` : null }),
        },
      }
  }
}

/** What the form must supply for a type. */
export function missingPushFields(target: PushTarget): string | null {
  if (target.type === "TELEGRAM") {
    if (!target.token) return "Telegram needs the bot token."
    if (!target.chatId) return "Telegram needs the chat ID."
    return null
  }
  return target.url ? null : "Enter the webhook URL."
}
