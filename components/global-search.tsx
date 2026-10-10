"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { searchHref, semanticOn } from "@/lib/search/href"

// The header's search box. Semantic search is on; the results page has the
// switch to turn it off, and searching again from there keeps that choice.
export function GlobalSearch({ className }: { className?: string }) {
  const pathname = usePathname()
  const params = useSearchParams()
  const onSearchPage = pathname === "/search"
  const urlQ = onSearchPage ? (params.get("q") ?? "") : ""
  const semantic = !onSearchPage || semanticOn(params.get("semantic"))
  // Remounting on a URL change (back/forward, the page's own links) resets the box to match.
  return <SearchForm key={urlQ} className={className} urlQ={urlQ} semantic={semantic} />
}

function SearchForm({ className, urlQ, semantic }: { className?: string; urlQ: string; semantic: boolean }) {
  const router = useRouter()
  const [q, setQ] = useState(urlQ)
  // Phones get an icon; tapping it lays the box over the header.
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // "/" focuses the box, as on most sites, unless the user is already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])


  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search everything"
        aria-expanded={open}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground sm:hidden"
      >
        <Search className="h-4 w-4" />
      </button>
      <div
        className={cn(
          "hidden w-full justify-center sm:flex",
          open && "max-sm:fixed max-sm:inset-x-0 max-sm:top-0 max-sm:z-50 max-sm:flex max-sm:h-14 max-sm:items-center max-sm:gap-2 max-sm:border-b max-sm:border-border/60 max-sm:bg-card max-sm:px-4"
        )}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
        }}
      >
        <form
          role="search"
          className={cn(
            "flex h-9 w-full items-center gap-1 rounded-lg border border-input bg-background/70 px-2.5 shadow-xs transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
            className
          )}
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = q.trim()
            if (!trimmed) return
            setOpen(false)
            router.push(searchHref(trimmed, semantic))
          }}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={input}
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything…"
            aria-label="Search everything"
            className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
        </form>
        {open && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close search"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </>
  )
}
