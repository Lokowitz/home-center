"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, Inbox, Loader2, Paperclip, RotateCcw, Square, SquarePen, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { uploadAccept } from "@/lib/inbox-form"
import { INBOX_HREF, inboxFollowUpQuestion, inboxNoticeText } from "@/lib/llm/inbox"
import { addFileToInbox } from "@/components/inbox/add-to-inbox"
import { useDropZone } from "@/components/drop/drop-provider"
import { useChat } from "./chat-provider"
import { Markdown } from "./markdown"
import type { ChatNotice } from "./use-chat-thread"

const ACCEPT = uploadAccept()

const EXAMPLES = [
  "How much did we spend on each vehicle last year?",
  "What maintenance is overdue or due soon?",
  "Which medications need a refill soon?",
  "When was the furnace last serviced?",
]

/**
 * A first answer the link check threw out: kept visible and struck through so
 * text doesn't silently vanish. Plain text, so its unverified links can't be clicked.
 */
function DiscardedAnswer({ text, pending }: { text: string; pending: boolean }) {
  const struck = <p className="whitespace-pre-wrap text-sm text-muted-foreground line-through decoration-muted-foreground/70">{text}</p>
  const note = pending
    ? "This answer linked to records the assistant hadn’t looked up, so it may be wrong. Checking and writing a new answer…"
    : "The first answer linked to records the assistant hadn’t looked up, so it was replaced by the one below."
  return (
    <div className="mb-2 rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {note}
      </p>
      {pending ? (
        struck
      ) : (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Show the replaced answer</summary>
          <div className="mt-1">{struck}</div>
        </details>
      )}
    </div>
  )
}

function Bubble({
  role, content, discarded, pending = false,
}: { role: "user" | "assistant"; content: string; discarded?: string | null; pending?: boolean }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{content}</p>
      </div>
    )
  }
  return (
    <div className="max-w-full">
      {discarded && <DiscardedAnswer text={discarded} pending={pending} />}
      {content && <Markdown>{content}</Markdown>}
    </div>
  )
}

/** The page's own line in the transcript, e.g. after a file went to Intake. Not from the model. */
function Notice({ notice }: { notice: ChatNotice }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      <Inbox className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p>
        {notice.text}{" "}
        <Link href={notice.href} className="text-primary underline">
          Open Intake
        </Link>
      </p>
    </div>
  )
}

function Unavailable({ isAdmin, className }: { isAdmin: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground", className)}>
      {isAdmin ? (
        <p>
          The assistant isn&apos;t set up yet.{" "}
          <Link href="/settings?tab=assistant" className="text-primary underline">
            Configure it in Settings
          </Link>
          .
        </p>
      ) : (
        <p>The assistant isn&apos;t set up yet. Ask an administrator to configure it.</p>
      )}
    </div>
  )
}

export function ChatThread({ className }: { className?: string }) {
  const chat = useChat()
  const router = useRouter()
  const [input, setInput] = useState("")
  const [uploading, setUploading] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [chat.messages, chat.notices, chat.draft, chat.discarded, chat.statusLabel, chat.error])

  // Dropped files go to Intake from here, with the same note in the conversation as the paperclip.
  const { setElement: setDropElement, over: dropOver } = useDropZone({ label: "Add to Intake from this chat", onFiles: (files) => void attach(files) })

  if (!chat.available) return <Unavailable isAdmin={chat.isAdmin} className={className} />

  /** Files go to Intake, not to the model: the assistant can then read what was parsed with its intake tool. */
  async function attach(list: FileList | File[] | null) {
    const files = list ? Array.from(list) : []
    if (!files.length) return
    setUploading((n) => n + files.length)
    const landed = await Promise.all(
      files.map(async (f) => {
        const ok = await addFileToInbox(f, { successToast: false })
        setUploading((n) => n - 1)
        return ok ? f.name : null
      })
    )
    const names = landed.filter((n): n is string => n !== null)
    if (!names.length) return
    chat.addNotice(inboxNoticeText(names), INBOX_HREF)
    setInput((current) => current || inboxFollowUpQuestion(names))
    // The sidebar's Intake badge.
    router.refresh()
  }

  function submit(text: string = input) {
    if (!text.trim() || chat.busy) return
    chat.send(text)
    setInput("")
  }

  const empty = chat.messages.length === 0 && chat.notices.length === 0 && chat.draft === null && !chat.error
  const noticesAfter = (count: number) => chat.notices.filter((n) => n.after === count).map((n) => <Notice key={`n${n.id}`} notice={n} />)

  return (
    <div
      ref={setDropElement}
      className={cn("flex min-h-0 flex-1 flex-col rounded-md", dropOver && "outline-2 outline-dashed outline-primary", className)}
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-1 py-2" aria-live="polite">
        {empty && (
          <div className="space-y-2 pt-4">
            <p className="text-sm text-muted-foreground">Ask about your home, vehicles, equipment, health records or spending. For example:</p>
            <div className="flex flex-col items-start gap-2">
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submit(q)}
                  className="rounded-lg border px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {noticesAfter(0)}
        {chat.messages.map((m, i) => [
          <Bubble key={i} role={m.role} content={m.content} discarded={m.discarded} />,
          ...noticesAfter(i + 1),
        ])}
        {chat.draft || chat.discarded ? <Bubble role="assistant" content={chat.draft ?? ""} discarded={chat.discarded} pending /> : null}
        {chat.busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {chat.statusLabel ?? "Thinking…"}
          </p>
        )}
        {chat.error && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <p>{chat.error}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={chat.retry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}
        {/* A reload mid-turn leaves the question unanswered, with no error to retry from. */}
        {!chat.busy && !chat.error && chat.messages.at(-1)?.role === "user" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>No answer yet.</span>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={chat.retry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Ask a question…"
          rows={2}
          maxLength={8000}
          className="resize-none"
          aria-label="Message"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={chat.reset}
              disabled={chat.messages.length === 0 && chat.notices.length === 0 && !chat.busy && !chat.error}
            >
              <SquarePen className="h-3.5 w-3.5" />
              New chat
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => pickRef.current?.click()}
              disabled={uploading > 0}
              title="Add receipts or invoices to Intake"
            >
              {uploading > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              <span className="sr-only md:not-sr-only">Add to Intake</span>
            </Button>
            <input
              ref={pickRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                void attach(e.target.files)
                e.target.value = ""
              }}
            />
          </div>
          {chat.busy ? (
            <Button type="button" size="sm" variant="outline" onClick={chat.stop}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!input.trim()}>
              <ArrowUp className="h-3.5 w-3.5" />
              Send
            </Button>
          )}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Answers are generated from your HomeCenter data by {chat.model ?? "the configured model"} and can be wrong.
        </p>
      </form>
    </div>
  )
}
