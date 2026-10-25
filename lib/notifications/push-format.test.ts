import { describe, expect, it } from "vitest"
import { buildPushRequest, groupForPush, missingPushFields, renderPushText, type PushRow } from "./push-format"

const row = (over: Partial<PushRow> = {}): PushRow => ({
  id: "r1", type: "MAINTENANCE_DUE", title: "Boiler service", message: "Due in 5 days", relatedEntityId: "m1", cycleKey: "c1", stage: "REACHED", ...over,
})

describe("groupForPush", () => {
  it("merges the same item across several users", () => {
    const { items, rowIds } = groupForPush([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })])
    expect(items).toHaveLength(1)
    expect(rowIds).toEqual(["a", "b", "c"])
  })
  it("keeps a different stage or cycle as its own item", () => {
    expect(groupForPush([row({ id: "a" }), row({ id: "b", stage: "DUE" }), row({ id: "c", cycleKey: "c2" })]).items).toHaveLength(3)
  })
  it("never merges rows with no related entity", () => {
    expect(groupForPush([row({ id: "a", relatedEntityId: null }), row({ id: "b", relatedEntityId: null })]).items).toHaveLength(2)
  })
})

describe("renderPushText", () => {
  const items = [{ type: "X", title: "Boiler", message: "Due soon" }]
  it("has a heading, the item and a link", () => {
    const t = renderPushText(items, "https://home.example.com", 1000)
    expect(t).toContain("HomeCenter: 1 item needs attention")
    expect(t).toContain("- Boiler\n  Due soon")
    expect(t).toContain("https://home.example.com/notifications")
  })
  it("pluralises", () => {
    expect(renderPushText([...items, ...items], null, 1000)).toContain("2 items need attention")
  })
  it("drops whole entries from the end and says how many", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ type: "X", title: `Item ${i}`, message: "x".repeat(40) }))
    const t = renderPushText(many, null, 500)
    expect(t.length).toBeLessThanOrEqual(500)
    expect(t).toMatch(/\+\d+ more$/)
    expect(t).toContain("Item 0")
  })
})

describe("buildPushRequest", () => {
  const items = [{ type: "X", title: "Boiler", message: "Due soon" }]
  const t = (o: object) => ({ type: "DISCORD" as const, url: "https://discord.com/api/webhooks/1/x", token: null, chatId: null, ...o })

  it("Discord turns mentions off and stays under 2000 characters", () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ type: "X", title: `Item ${i}`, message: "m".repeat(60) }))
    const req = buildPushRequest(t({}), big, null)!
    const body = JSON.parse(req.init.body)
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content.length).toBeLessThan(2000)
  })
  it("ntfy sends text with an ASCII title and optional bearer", () => {
    const req = buildPushRequest(t({ type: "NTFY", url: "https://ntfy.sh/mytopic", token: "tk" }), items, "https://h.example")!
    expect(req.init.headers).toMatchObject({ Title: "HomeCenter", Authorization: "Bearer tk", Click: "https://h.example/notifications" })
    expect(req.init.body).toContain("Boiler")
  })
  it("Telegram builds its URL from the token and sends the chat ID", () => {
    const req = buildPushRequest(t({ type: "TELEGRAM", url: null, token: "123:abc", chatId: "-100" }), items, null)!
    expect(req.url).toBe("https://api.telegram.org/bot123:abc/sendMessage")
    expect(JSON.parse(req.init.body).chat_id).toBe("-100")
  })
  it("JSON carries a count, the items and the text", () => {
    const body = JSON.parse(buildPushRequest(t({ type: "JSON" }), items, null)!.init.body)
    expect(body).toMatchObject({ source: "homecenter", count: 1, url: null })
    expect(body.items[0].title).toBe("Boiler")
  })
  it("returns null when a type lacks what it needs", () => {
    expect(buildPushRequest(t({ url: null }), items, null)).toBeNull()
    expect(buildPushRequest(t({ type: "TELEGRAM", url: null, chatId: null, token: "x" }), items, null)).toBeNull()
  })
})

describe("missingPushFields", () => {
  it("names what is missing", () => {
    expect(missingPushFields({ type: "DISCORD", url: null, token: null, chatId: null })).toMatch(/URL/)
    expect(missingPushFields({ type: "TELEGRAM", url: null, token: null, chatId: "1" })).toMatch(/token/)
    expect(missingPushFields({ type: "TELEGRAM", url: null, token: "t", chatId: null })).toMatch(/chat ID/)
    expect(missingPushFields({ type: "NTFY", url: "https://ntfy.sh/x", token: null, chatId: null })).toBeNull()
  })
})
