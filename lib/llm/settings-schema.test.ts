import { describe, expect, it } from "vitest"
import { assistantShown, documentSwitchError, isLlmReady, isOffNetworkUrl, LLM_PRESETS, originChanged, parseExtraBody, parseLlmSettings, type LlmSettingsInput } from "./settings-schema"

const base: LlmSettingsInput = {
  enabled: true,
  baseUrl: "https://api.openai.com/v1/",
  model: "gpt-4o-mini",
  temperature: "",
  maxTokens: "",
  systemPrompt: "",
}

describe("parseLlmSettings", () => {
  it("defaults document access on and health documents off", () => {
    const r = parseLlmSettings(base)
    expect(r.ok && r.value.documentsEnabled).toBe(true)
    expect(r.ok && r.value.healthDocumentsEnabled).toBe(false)
  })

  it("keeps the document switches as sent", () => {
    const r = parseLlmSettings({ ...base, documentsEnabled: false, healthDocumentsEnabled: true })
    expect(r.ok && r.value.documentsEnabled).toBe(false)
    expect(r.ok && r.value.healthDocumentsEnabled).toBe(true)
  })

  it("normalises a complete config", () => {
    const r = parseLlmSettings({ ...base, temperature: "0.2", maxTokens: "1500", systemPrompt: " Be brief. " })
    expect(r).toEqual({
      ok: true,
      value: {
        enabled: true,
        hidden: false,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 1500,
        systemPrompt: "Be brief.",
        timeoutSeconds: null,
        maxToolRounds: null,
        extraBody: null,
        documentsEnabled: true,
        healthDocumentsEnabled: false,
      },
    })
  })

  it("stores blanks as null", () => {
    const r = parseLlmSettings({ ...base, enabled: false, baseUrl: "", model: "" })
    expect(r).toEqual({
      ok: true,
      value: {
        enabled: false, hidden: false, baseUrl: null, model: null, temperature: null, maxTokens: null, systemPrompt: null,
        timeoutSeconds: null, maxToolRounds: null, extraBody: null, documentsEnabled: true, healthDocumentsEnabled: false,
      },
    })
  })

  it("keeps hidden while on: saving Advanced settings must not bring the assistant back", () => {
    const r = parseLlmSettings({ ...base, hidden: true })
    expect(r).toMatchObject({ ok: true, value: { enabled: true, hidden: true } })
    expect(parseLlmSettings({ ...base, hidden: false })).toMatchObject({ ok: true, value: { enabled: true, hidden: false } })
  })

  it("keeps hidden while off", () => {
    const r = parseLlmSettings({ ...base, enabled: false, baseUrl: "", model: "", hidden: true })
    expect(r).toMatchObject({ ok: true, value: { enabled: false, hidden: true } })
  })

  it("rejects non-http URLs", () => {
    expect(parseLlmSettings({ ...base, baseUrl: "ftp://x" })).toEqual({ ok: false, error: "Base URL must be an http(s) URL." })
    expect(parseLlmSettings({ ...base, baseUrl: "not a url" })).toEqual({ ok: false, error: "Base URL must be an http(s) URL." })
  })

  it("rejects out-of-range numbers", () => {
    expect(parseLlmSettings({ ...base, temperature: "3" })).toMatchObject({ ok: false, error: "Temperature must be between 0 and 2." })
    expect(parseLlmSettings({ ...base, maxTokens: "0" })).toMatchObject({ ok: false, error: "Max tokens must be a whole number from 1 to 32000." })
    expect(parseLlmSettings({ ...base, maxTokens: "1.5" })).toMatchObject({ ok: false })
  })

  it("requires URL and model to enable, unless told otherwise", () => {
    expect(parseLlmSettings({ ...base, model: "" })).toEqual({
      ok: false,
      error: "Base URL and model are required to turn the assistant on.",
    })
    expect(parseLlmSettings({ ...base, model: "" }, { requireComplete: false }).ok).toBe(true)
  })
})

describe("isLlmReady", () => {
  const ready = { enabled: true, baseUrl: "http://x/v1", model: "m", keyUnreadable: false }
  it("needs enabled, URL, model and a readable key", () => {
    expect(isLlmReady(ready)).toBe(true)
    expect(isLlmReady({ ...ready, enabled: false })).toBe(false)
    expect(isLlmReady({ ...ready, baseUrl: null })).toBe(false)
    expect(isLlmReady({ ...ready, model: null })).toBe(false)
    expect(isLlmReady({ ...ready, keyUnreadable: true })).toBe(false)
  })
})

describe("LLM_PRESETS", () => {
  it("has http(s) base URLs without trailing slashes", () => {
    for (const p of LLM_PRESETS) expect(p.baseUrl).toMatch(/^https?:\/\/.+[^/]$/)
  })
})

describe("originChanged", () => {
  it("is true only when both URLs are set and their origins differ", () => {
    expect(originChanged("https://api.openai.com/v1", "https://api.openai.com/v2")).toBe(false)
    expect(originChanged("https://api.openai.com/v1", "https://openrouter.ai/api/v1")).toBe(true)
    expect(originChanged("http://localhost:11434/v1", "http://localhost:1234/v1")).toBe(true)
    expect(originChanged(null, "https://openrouter.ai/api/v1")).toBe(false)
    expect(originChanged("https://api.openai.com/v1", null)).toBe(false)
  })
})

describe("time limit and extra request JSON", () => {
  it("accepts a time limit in range", () => {
    expect(parseLlmSettings({ ...base, timeoutSeconds: "300" })).toMatchObject({ ok: true, value: { timeoutSeconds: 300 } })
    expect(parseLlmSettings({ ...base, maxToolRounds: "10" })).toMatchObject({ ok: true, value: { maxToolRounds: 10 } })
    expect(parseLlmSettings({ ...base, maxToolRounds: "2" })).toEqual({ ok: false, error: "Lookup rounds must be a whole number from 3 to 12." })
    expect(parseLlmSettings({ ...base, maxToolRounds: "6.5" })).toMatchObject({ ok: false })
    expect(parseLlmSettings({ ...base, timeoutSeconds: "10" })).toEqual({
      ok: false,
      error: "Time limit must be a whole number of seconds from 30 to 900.",
    })
  })

  it("normalises a JSON object and rejects anything else", () => {
    const r = parseLlmSettings({ ...base, extraBody: ' { "chat_template_kwargs": { "enable_thinking": true } } ' })
    expect(r).toMatchObject({ ok: true, value: { extraBody: '{"chat_template_kwargs":{"enable_thinking":true}}' } })
    expect(parseLlmSettings({ ...base, extraBody: "{nope" })).toEqual({ ok: false, error: "Extra request JSON must be a JSON object." })
    expect(parseLlmSettings({ ...base, extraBody: "[1]" })).toEqual({ ok: false, error: "Extra request JSON must be a JSON object." })
  })

  it("refuses fields the assistant sets itself", () => {
    expect(parseLlmSettings({ ...base, extraBody: '{"model":"x","stream":false}' })).toEqual({
      ok: false,
      error: "Extra request JSON can't set model, stream — the assistant sets those.",
    })
  })

  it("parseExtraBody reads stored JSON safely", () => {
    expect(parseExtraBody('{"a":1}')).toEqual({ a: 1 })
    expect(parseExtraBody(null)).toBeNull()
    expect(parseExtraBody("garbage")).toBeNull()
  })
})

describe("isOffNetworkUrl", () => {
  it("only treats fc/fd/fe80 as private for IPv6 addresses, not for host names", () => {
    expect(isOffNetworkUrl("https://fcapi.example.com/v1")).toBe(true)
    expect(isOffNetworkUrl("https://fdn.openrouter-proxy.com/v1")).toBe(true)
    expect(isOffNetworkUrl("http://[fe80::1]/v1")).toBe(false)
    expect(isOffNetworkUrl("http://[fc00::7]/v1")).toBe(false)
  })

  it("judges an IPv4-mapped IPv6 address by its IPv4 part", () => {
    expect(isOffNetworkUrl("http://[::ffff:192.168.1.5]:11434/v1")).toBe(false)
    expect(isOffNetworkUrl("http://[::ffff:10.0.0.9]/v1")).toBe(false)
    expect(isOffNetworkUrl("http://[::ffff:8.8.8.8]/v1")).toBe(true)
  })

  it("is false for this machine, the LAN and Docker hostnames", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://[::1]:8080/v1",
      "http://192.168.1.20:11434/v1",
      "http://10.0.0.5/v1",
      "http://172.20.0.3:11434/v1",
      "http://100.101.102.103/v1",
      "http://[fd12::5]/v1",
      "http://ollama:11434/v1",
      "http://host.docker.internal:11434/v1",
      "http://nas.local:1234/v1",
      "http://llm.home.arpa/v1",
      "http://box.lan/v1",
    ]) expect(isOffNetworkUrl(url), url).toBe(false)
  })

  it("is true for public hosts and public IPs", () => {
    expect(isOffNetworkUrl("https://api.openai.com/v1")).toBe(true)
    expect(isOffNetworkUrl("https://openrouter.ai/api/v1")).toBe(true)
    expect(isOffNetworkUrl("http://172.32.0.1/v1")).toBe(true)
    expect(isOffNetworkUrl("http://8.8.8.8/v1")).toBe(true)
  })

  it("is false when the URL is blank or can't be read", () => {
    expect(isOffNetworkUrl("")).toBe(false)
    expect(isOffNetworkUrl("not a url")).toBe(false)
  })
})

describe("assistantShown", () => {
  it("shows the assistant only when it's ready and not hidden", () => {
    expect(assistantShown({ available: true, hidden: false })).toBe(true)
    // On and working, but kept out of the nav menu and the top-right button.
    expect(assistantShown({ available: true, hidden: true })).toBe(false)
    expect(assistantShown({ available: false, hidden: false })).toBe(false)
    expect(assistantShown({ available: false, hidden: true })).toBe(false)
  })
})

describe("documentSwitchError", () => {
  it("refuses to turn on document reading while the assistant is off", () => {
    expect(documentSwitchError({ enabled: false }, { documentsEnabled: true })).toBe("Turn on the assistant first.")
    expect(documentSwitchError({ enabled: false }, { healthDocumentsEnabled: true })).toBe("Turn on the assistant first.")
  })

  it("allows them with the assistant on, when turning them off, or when turning both on together", () => {
    expect(documentSwitchError({ enabled: true }, { documentsEnabled: true })).toBeNull()
    expect(documentSwitchError({ enabled: false }, { documentsEnabled: false, healthDocumentsEnabled: false })).toBeNull()
    expect(documentSwitchError({ enabled: true }, { enabled: true, documentsEnabled: true })).toBeNull()
    expect(documentSwitchError({ enabled: false }, { hidden: true })).toBeNull()
  })
})
