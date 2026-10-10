"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createNdjsonReader } from "@/lib/llm/ndjson"
import { clearThread, loadThread, requestMessages, saveThread, shouldPersist, type ThreadMessage } from "@/lib/llm/thread-storage"
import type { AgentEvent } from "@/lib/llm/types"

function storage() {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

const SESSION_EXPIRED = "Your session has expired — sign in again."
const CUT_OFF = "The answer was cut off — try again."

/**
 * A line the page itself adds to the transcript (e.g. "Added receipt.pdf to
 * your Inbox"). Shown after the first `after` messages; never saved or sent to
 * the model, so it disappears on reload.
 */
export type ChatNotice = { id: number; text: string; href: string; after: number }

export function useChatThread(userId: string) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  /** The in-flight assistant text; null when no turn is running. */
  const [draft, setDraft] = useState<string | null>(null)
  /** This turn's first answer, when the link check threw it out and a new one is coming. */
  const [discarded, setDiscarded] = useState<string | null>(null)
  const [statusLabel, setStatusLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notices, setNotices] = useState<ChatNotice[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const noticeId = useRef(0)

  // sessionStorage only exists in the browser, so the thread loads after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is browser-only; reading it during render would break hydration
    setMessages(loadThread(storage(), userId))
  }, [userId])

  const persist = useCallback(
    (next: ThreadMessage[]) => {
      setMessages(next)
      saveThread(storage(), userId, next)
    },
    [userId]
  )

  const run = useCallback(
    async (thread: ThreadMessage[]) => {
      const started = generation.current
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true)
      setError(null)
      setDraft("")
      setDiscarded(null)
      setStatusLabel(null)

      const turn = { text: "", discarded: null as string | null, failure: null as string | null, done: false }
      const answer = (): ThreadMessage => ({ role: "assistant", content: turn.text, ...(turn.discarded ? { discarded: turn.discarded } : {}) })
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: requestMessages(thread) }),
          signal: controller.signal,
        })
        // First: a redirect to the login page can end on a non-OK response too.
        if (res.redirected) throw new Error(SESSION_EXPIRED)
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `Request failed (${res.status}).`)
        }
        if (!res.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error(SESSION_EXPIRED)
        const reader = createNdjsonReader<AgentEvent>((event) => {
          if (event.type === "delta") {
            turn.text += event.text
            setDraft(turn.text)
          } else if (event.type === "reset") {
            if (event.reason === "recheck" && turn.text.trim()) {
              turn.discarded = turn.text
              setDiscarded(turn.text)
            }
            turn.text = ""
            setDraft("")
          } else if (event.type === "status") {
            setStatusLabel(event.label)
          } else if (event.type === "error") {
            turn.failure = event.message
          } else if (event.type === "done") {
            turn.done = true
          }
        })
        const stream = res.body.pipeThrough(new TextDecoderStream()).getReader()
        for (;;) {
          const { value, done } = await stream.read()
          if (done) break
          reader.feed(value)
        }
        reader.flush()
        if (turn.failure) throw new Error(turn.failure)
        // A stream that ends without "done" was cut off; its partial text isn't kept.
        if (!turn.done && !controller.signal.aborted) throw new Error(CUT_OFF)
        if (turn.text.trim() && shouldPersist(started, generation.current)) {
          persist([...thread, answer()])
        }
      } catch (e) {
        if (!shouldPersist(started, generation.current)) return
        if (controller.signal.aborted) {
          // Stop keeps whatever arrived.
          if (turn.text.trim()) persist([...thread, answer()])
        } else {
          setError(e instanceof Error ? e.message : "Something went wrong.")
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (shouldPersist(started, generation.current)) {
          setBusy(false)
          setDraft(null)
          setDiscarded(null)
          setStatusLabel(null)
        }
      }
    },
    [persist]
  )

  const send = useCallback(
    (text: string) => {
      const content = text.trim()
      if (!content || busy) return
      const next: ThreadMessage[] = [...messages, { role: "user", content }]
      persist(next)
      void run(next)
    },
    [busy, messages, persist, run]
  )

  /** Re-asks after a failure; the user's message is still the last one. */
  const retry = useCallback(() => {
    if (!busy && messages.at(-1)?.role === "user") void run(messages)
  }, [busy, messages, run])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const addNotice = useCallback(
    (text: string, href: string) => {
      noticeId.current += 1
      const notice = { id: noticeId.current, text, href, after: messages.length }
      setNotices((ns) => [...ns, notice])
    },
    [messages.length]
  )

  const reset = useCallback(() => {
    generation.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    clearThread(storage(), userId)
    setMessages([])
    setNotices([])
    setError(null)
    setBusy(false)
    setDraft(null)
    setDiscarded(null)
    setStatusLabel(null)
  }, [userId])

  return { messages, notices, draft, discarded, statusLabel, error, busy, send, retry, stop, reset, addNotice }
}
