import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { loadLlmConfig } from "@/lib/llm/config"
import { DEFAULT_TIMEOUT_SECONDS, DEFAULT_TOOL_ROUNDS, isLlmReady, parseExtraBody } from "@/lib/llm/settings-schema"
import { createChatClient } from "@/lib/llm/client"
import { agentErrorMessage, LlmError } from "@/lib/llm/errors"
import { runAgent } from "@/lib/llm/agent"
import { buildSystemPrompt } from "@/lib/llm/prompt"
import { stripDraftLines } from "@/lib/llm/strip-drafts"
import { chatRequestSchema, firstIssue } from "@/lib/llm/request-schema"
import { chatTools } from "@/lib/llm/tools"
import { loadDocumentSettings } from "@/lib/documents/settings"
import { documentAccess } from "@/lib/documents/tool-helpers"
import type { AgentEvent } from "@/lib/llm/types"
import { getFormat } from "@/lib/regional-server"
import { loadFeatures } from "@/lib/features-server"
import { loadHiddenEntityIds, loadPropertyScope } from "@/lib/property-filter-server"

export const runtime = "nodejs"

// Streams one assistant turn as NDJSON. The thread arrives from the browser on
// every request and is never stored. Logs carry tool names and timings only —
// never message content or tool results, which include health records.
export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 })
  }
  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })

  const config = await loadLlmConfig()
  if (!isLlmReady(config) || !config.baseUrl || !config.model) {
    const error = config.keyUnreadable
      ? "The saved API key can't be decrypted — an admin needs to re-enter it in Settings."
      : "The assistant isn't configured. An admin can set it up in Settings."
    return NextResponse.json({ error }, { status: 503 })
  }
  const { health, rooms } = await loadFeatures()
  // With Health off, health files are out of reach whatever the assistant's own setting says.
  const docs = documentAccess(await loadDocumentSettings(), { ...config, healthDocumentsEnabled: health && config.healthDocumentsEnabled })
  // The chat panel's fetch is same-origin, so the property filter cookie comes along:
  // the assistant sees what the page around it sees.
  const scope = await loadPropertyScope()
  const hiddenEntityIds = await loadHiddenEntityIds(scope)

  // Per-question limit from Settings; each model call separately fails only after
  // a stretch with no output (see IDLE_TIMEOUT_MS in lib/llm/client.ts).
  const timeout = AbortSignal.timeout((config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000)
  const signal = AbortSignal.any([request.signal, timeout])
  const chat = createChatClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    extraBody: parseExtraBody(config.extraBody),
  })
  const model = config.model
  const maxRounds = config.maxToolRounds ?? DEFAULT_TOOL_ROUNDS
  const userId = session.user.id
  const encoder = new TextEncoder()
  const started = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // Client went away; the abort signal stops the loop.
        }
      }
      const used: string[] = []
      let rounds = 0
      try {
        const now = new Date()
        await runAgent({
          history: health ? parsed.data.messages : stripDraftLines(parsed.data.messages),
          systemPrompt: buildSystemPrompt({ now, extra: config.systemPrompt, maxRounds, documents: docs.enabled, health, rooms, fmt: await getFormat(), today: parsed.data.today, viewing: scope?.propertyName }),
          chat,
          tools: chatTools(docs, health, config.healthDocumentsEnabled, rooms),
          ctx: { userId, now, health, rooms, today: parsed.data.today, scope, hiddenEntityIds },
          signal,
          model,
          maxRounds,
          emit: (event) => {
            if (event.type === "status") used.push(event.tool)
            if (event.type === "done") rounds = event.rounds
            send(event)
          },
        })
      } catch (error) {
        if (!request.signal.aborted) send({ type: "error", message: agentErrorMessage(error, timeout.aborted) })
        console.error(
          "[llm] chat failed:",
          error instanceof LlmError ? `LlmError${error.status ? ` status=${error.status}` : ""}` : error instanceof Error ? error.name : typeof error
        )
      } finally {
        console.info(`[llm] chat user=${userId} rounds=${rounds} tools=${used.join(",") || "-"} ms=${Date.now() - started}`)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  })
}
