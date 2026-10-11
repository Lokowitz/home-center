"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"
import { Maximize2, MessageSquare, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isWide, useChat } from "./chat-provider"
import { ChatThread } from "./chat-thread"

/** Header button that opens and closes the docked assistant (Settings → Appearance → Top bar). */
export function ChatToggle() {
  const chat = useChat()
  const pathname = usePathname()
  // The full page already shows the thread.
  if (pathname === "/chat") return null

  return (
    <button
      type="button"
      onClick={() => chat.setPanelOpen(!chat.panelOpen)}
      aria-pressed={chat.panelOpen}
      title="Assistant"
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted",
        chat.panelOpen && "bg-muted text-foreground"
      )}
    >
      <MessageSquare className="h-4 w-4" />
      {chat.busy && <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-primary" />}
      <span className="sr-only">{chat.panelOpen ? "Close assistant" : "Open assistant"}</span>
    </button>
  )
}

/**
 * Round button floating in the bottom-right corner, above the footer, that
 * opens the docked assistant. Hidden while the dock is open (the dock takes
 * that corner and has its own close button) and on the full chat page.
 */
export function ChatLauncher() {
  const chat = useChat()
  const pathname = usePathname()
  if (pathname === "/chat" || chat.panelOpen) return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => chat.setPanelOpen(true)}
            aria-label="Open assistant"
            className="fixed right-5 bottom-14 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/20 transition-all duration-150 hover:scale-105 hover:bg-primary/90 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50 motion-reduce:hover:scale-100"
          >
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            {/* An answer is still being written while the dock is closed. */}
            {chat.busy && (
              <span className="absolute top-0.5 right-0.5 h-3 w-3 animate-pulse rounded-full bg-primary-foreground ring-2 ring-primary" />
            )}
          </button>
        }
      />
      <TooltipContent
        side="left"
        sideOffset={10}
        className="border border-border bg-popover px-2.5 py-1.5 text-sm font-medium text-popover-foreground shadow-md"
      >
        Assistant
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The assistant docked beside the page: opening it narrows the page instead of
 * covering it, so both stay usable. On phones there is no room for two
 * columns, so it covers the screen instead (still without a backdrop).
 */
export function ChatDock() {
  const chat = useChat()
  const pathname = usePathname()
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const { setPanelOpen } = chat
  const lastPath = useRef(pathname)

  // On a phone the panel covers the page, so following a link from an answer
  // closes it to show where the link went. Side by side, it stays open.
  useEffect(() => {
    if (pathname !== lastPath.current && !isWide()) setPanelOpen(false)
    lastPath.current = pathname
  }, [pathname, setPanelOpen])

  if (!chat.panelOpen || pathname === "/chat") return null

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = { startX: e.clientX, startWidth: chat.panelWidth }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.style.userSelect = "none"
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    // The handle is on the left edge: dragging left widens the panel.
    chat.setPanelWidth(drag.current.startWidth + (drag.current.startX - e.clientX))
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    chat.setPanelWidth(drag.current.startWidth + (drag.current.startX - e.clientX), true)
    drag.current = null
    document.body.style.userSelect = ""
  }

  return (
    <aside
      aria-label="Assistant"
      style={{ "--chat-w": `${chat.panelWidth}px` } as React.CSSProperties}
      className="fixed inset-0 z-40 flex flex-col bg-card p-4 md:relative md:inset-auto md:z-auto md:w-[var(--chat-w)] md:shrink-0 md:border-l md:border-border/60"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute inset-y-0 -left-1 hidden w-2 cursor-col-resize hover:bg-primary/20 md:block"
      />
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-heading text-base font-semibold">Assistant</h2>
        <Link
          href="/chat"
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Open full page
        </Link>
        <button
          type="button"
          onClick={() => chat.setPanelOpen(false)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close assistant</span>
        </button>
      </div>
      <ChatThread />
    </aside>
  )
}
