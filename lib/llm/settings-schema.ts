import { z } from "zod"

// Pure validation for the Settings → Assistant form. Shared by the server
// actions and the layout's availability check; no database access here.

export const LLM_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
] as const

const schema = z.object({
  enabled: z.boolean(),
  hidden: z.boolean().optional(),
  baseUrl: z.string().trim(),
  // Empty means "leave the stored key alone" — the browser never sees it.
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  model: z.string().trim(),
  temperature: z.string().trim().optional(),
  maxTokens: z.string().trim().optional(),
  systemPrompt: z.string().trim().max(4000).optional(),
  timeoutSeconds: z.string().trim().optional(),
  maxToolRounds: z.string().trim().optional(),
  extraBody: z.string().trim().max(2000).optional(),
  documentsEnabled: z.boolean().optional(),
  healthDocumentsEnabled: z.boolean().optional(),
})

export const DEFAULT_TIMEOUT_SECONDS = 180

/**
 * Rounds of lookups the assistant may make per question. Measured on
 * follow-ups with the local model: at 5, a re-checked spending follow-up
 * often ran out of rounds before redoing the lookup (12 of 14 re-checked
 * answers right); at 8, 14 of 14, for about 11 s more on those turns.
 * Questions that need fewer rounds never use the rest.
 */
export const DEFAULT_TOOL_ROUNDS = 8
export const TOOL_ROUNDS_RANGE = { min: 3, max: 12 } as const

/** Request fields the assistant builds itself; extra JSON may not replace them. */
const RESERVED_FIELDS = ["model", "messages", "stream", "tools", "tool_choice"]

export type LlmSettingsInput = z.infer<typeof schema>

export type ParsedLlmSettings = {
  enabled: boolean
  /** Hides the assistant from the nav and header. Only meaningful while enabled is false. */
  hidden: boolean
  baseUrl: string | null
  model: string | null
  temperature: number | null
  maxTokens: number | null
  systemPrompt: string | null
  /** Per-question time limit; null = DEFAULT_TIMEOUT_SECONDS. */
  timeoutSeconds: number | null
  /** Most rounds of lookups per question; null = DEFAULT_TOOL_ROUNDS. */
  maxToolRounds: number | null
  /** Provider-specific request fields as normalised JSON, e.g. {"chat_template_kwargs":{"enable_thinking":true}}. */
  extraBody: string | null
  /** Offer the document tools to the assistant. */
  documentsEnabled: boolean
  /** Include files on health records in those tools. */
  healthDocumentsEnabled: boolean
}

type Result = { ok: true; value: ParsedLlmSettings } | { ok: false; error: string }

export function parseLlmSettings(input: LlmSettingsInput, opts: { requireComplete?: boolean } = {}): Result {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Invalid input." }
  const v = parsed.data

  let baseUrl: string | null = null
  if (v.baseUrl) {
    let url: URL
    try {
      url = new URL(v.baseUrl)
    } catch {
      return { ok: false, error: "Base URL must be an http(s) URL." }
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Base URL must be an http(s) URL." }
    baseUrl = v.baseUrl.replace(/\/+$/, "")
  }

  let temperature: number | null = null
  if (v.temperature) {
    const n = Number(v.temperature)
    if (!Number.isFinite(n) || n < 0 || n > 2) return { ok: false, error: "Temperature must be between 0 and 2." }
    temperature = n
  }

  let maxTokens: number | null = null
  if (v.maxTokens) {
    const n = Number(v.maxTokens)
    if (!Number.isInteger(n) || n < 1 || n > 32000) return { ok: false, error: "Max tokens must be a whole number from 1 to 32000." }
    maxTokens = n
  }

  let timeoutSeconds: number | null = null
  if (v.timeoutSeconds) {
    const n = Number(v.timeoutSeconds)
    if (!Number.isInteger(n) || n < 30 || n > 900) return { ok: false, error: "Time limit must be a whole number of seconds from 30 to 900." }
    timeoutSeconds = n
  }

  let maxToolRounds: number | null = null
  if (v.maxToolRounds) {
    const n = Number(v.maxToolRounds)
    const { min, max } = TOOL_ROUNDS_RANGE
    if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: `Lookup rounds must be a whole number from ${min} to ${max}.` }
    maxToolRounds = n
  }

  let extraBody: string | null = null
  if (v.extraBody) {
    const obj = parseExtraBody(v.extraBody)
    if (!obj) return { ok: false, error: "Extra request JSON must be a JSON object." }
    const reserved = RESERVED_FIELDS.filter((f) => f in obj)
    if (reserved.length) return { ok: false, error: `Extra request JSON can't set ${reserved.join(", ")} — the assistant sets those.` }
    extraBody = JSON.stringify(obj)
  }

  const model = v.model || null
  if ((opts.requireComplete ?? true) && v.enabled && (!baseUrl || !model)) {
    return { ok: false, error: "Base URL and model are required to turn the assistant on." }
  }

  return {
    ok: true,
    // Hidden is its own setting: the assistant can be on and hidden (see assistantShown).
    value: { enabled: v.enabled, hidden: v.hidden ?? false, baseUrl, model, temperature, maxTokens, systemPrompt: v.systemPrompt || null, timeoutSeconds, maxToolRounds, extraBody, documentsEnabled: v.documentsEnabled ?? true, healthDocumentsEnabled: v.healthDocumentsEnabled ?? false },
  }
}

/**
 * Whether the assistant has an entry point (nav item, header button, floating chat). It can be on and
 * working but hidden: features that use the AI model keep working without a visible chat.
 */
export function assistantShown(status: { available: boolean; hidden: boolean }): boolean {
  return status.available && !status.hidden
}

/** Document reading belongs to the assistant: it can't be switched on while the assistant is off. */
export function documentSwitchError(
  next: { enabled: boolean },
  patch: { enabled?: boolean; hidden?: boolean; documentsEnabled?: boolean; healthDocumentsEnabled?: boolean },
): string | null {
  const turningOn = patch.documentsEnabled === true || patch.healthDocumentsEnabled === true
  return turningOn && !next.enabled ? "Turn on the assistant first." : null
}

export function isLlmReady(c: { enabled: boolean; baseUrl: string | null; model: string | null; keyUnreadable: boolean }): boolean {
  return c.enabled && !!c.baseUrl && !!c.model && !c.keyUnreadable
}

/**
 * A stored API key belongs to the server it was saved for. True when both URLs
 * are set and point at different origins (so the key must not follow).
 */
export function originChanged(saved: string | null, next: string | null): boolean {
  if (!saved || !next) return false
  try {
    return new URL(saved).origin !== new URL(next).origin
  } catch {
    return true
  }
}

/**
 * True when the LLM server is outside this machine and the home network, so
 * questions and records leave the house. Blank or unreadable URLs are false.
 */
export function isOffNetworkUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "")
  } catch {
    return false
  }
  // Docker service names and other single-label hosts only resolve locally.
  if (!host.includes(".") && !host.includes(":")) return false
  if (/\.(localhost|local|lan|internal|home\.arpa)$/.test(host)) return false
  const isV6 = host.includes(":")
  // An IPv4 address written as IPv6 (::ffff:c0a8:105 is 192.168.1.5) is judged by its IPv4 part.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (mapped) {
    const hi = parseInt(mapped[1], 16)
    const lo = parseInt(mapped[2], 16)
    return isOffNetworkUrl(`http://${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}/`)
  }
  // Private IPv6 ranges only count for IPv6 addresses: a host name can start with "fc" or "fd" too.
  if (isV6 && (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith("fe80:"))) return false
  const ip = host.split(".").map(Number)
  if (ip.length === 4 && ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = ip
    return !(
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      // Tailscale and other carrier-grade NAT ranges.
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  return true
}

/** A stored or typed extra-request JSON object; null when blank or not an object. */
export function parseExtraBody(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
