import Link from "next/link"
import { SearchX, Sparkles } from "lucide-react"
import { globalSearch } from "@/lib/search/global-server"
import { loadPropertyScope } from "@/lib/property-filter-server"
import type { Section, SemanticState } from "@/lib/search/types"
import { AssetCard, DocumentCard, RecordCard } from "@/components/search/result-cards"
import { searchHref, semanticOn } from "@/lib/search/href"
import { cn } from "@/lib/utils"

export const metadata = { title: "Search" }

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""

const GRID: Record<Section["layout"], string> = {
  assets: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
  records: "grid gap-3 md:grid-cols-2 2xl:grid-cols-3",
  documents: "grid gap-3 lg:grid-cols-2",
}

function SectionBlock({ section, terms }: { section: Section; terms: string[] }) {
  return (
    <section id={section.key} className="scroll-mt-4 space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="font-heading text-lg font-semibold">{section.title}</h2>
        <span className="text-sm text-muted-foreground">
          {section.items.length}
          {section.more ? "+" : ""}
        </span>
      </div>
      <div className={GRID[section.layout]}>
        {section.layout === "assets" && section.items.map((item) => <AssetCard key={item.id} item={item} terms={terms} />)}
        {section.layout === "records" && section.items.map((item) => <RecordCard key={`${item.kind}:${item.id}`} item={item} terms={terms} />)}
        {section.layout === "documents" && section.items.map((item) => <DocumentCard key={item.attachmentId} item={item} terms={terms} />)}
      </div>
      {section.more && (
        <p className="text-xs text-muted-foreground">Showing the first {section.items.length}. Add words to narrow the search.</p>
      )}
    </section>
  )
}

/** Turns semantic results on or off for this search by reloading it. */
function SemanticSwitch({ q, on }: { q: string; on: boolean }) {
  return (
    <Link
      href={searchHref(q, !on)}
      role="switch"
      aria-checked={on}
      title={on ? "Also showing results related by meaning. Click for keyword matches only." : "Keyword matches only. Click to also show results related by meaning."}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border/60 bg-card py-1 pl-2.5 pr-1 text-xs font-medium hover:bg-muted"
    >
      <Sparkles className={cn("h-3.5 w-3.5", on ? "text-primary" : "text-muted-foreground")} />
      Semantic
      <span className={cn("relative h-4 w-7 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-background shadow-xs transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
    </Link>
  )
}

function SemanticNote({ state }: { state: SemanticState }) {
  const box = "flex items-start gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground"
  switch (state.state) {
    case "off":
      // The switch at the top says so.
      return null
    case "unavailable":
      return (
        <p className={box}>
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Semantic search isn&apos;t ready. Turn it on and install a model under{" "}
            <Link href="/settings?tab=documents" className="font-medium text-foreground underline-offset-4 hover:underline">Settings → Documents &amp; search</Link>
            , then let indexing finish.
          </span>
        </p>
      )
    case "failed":
      return (
        <p className={box}>
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Semantic search failed this time, so only keyword results are shown.</span>
        </p>
      )
    case "ok":
      // Its finds sit in the sections above, marked "Semantic".
      return null
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const q = first(params.q).trim()
  const semantic = semanticOn(first(params.semantic))

  if (!q) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center text-muted-foreground">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Search</h1>
        <p className="mt-2 text-sm">
          Use the search box at the top to look across properties, vehicles, equipment, people, records and the text of
          uploaded documents.
        </p>
      </div>
    )
  }

  const scope = await loadPropertyScope()
  const results = await globalSearch(q, { semantic, scope })
  const jump = results.sections.map((s) => ({ key: s.key, title: s.title, count: `${s.items.length}${s.more ? "+" : ""}` }))

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold">
              Results for <span className="text-primary">&ldquo;{results.query}&rdquo;</span>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {results.total} {results.total === 1 ? "match" : "matches"}
              {semantic ? " · keyword + semantic" : " · keyword"}
            </p>
          </div>
          <SemanticSwitch q={results.query} on={semantic} />
        </div>
        {jump.length > 1 && (
          <nav aria-label="Result sections" className="flex flex-wrap gap-1.5">
            {jump.map((s) => (
              <a
                key={s.key}
                href={`#${s.key}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs font-medium hover:bg-muted"
              >
                {s.title}
                <span className="text-muted-foreground">{s.count}</span>
              </a>
            ))}
          </nav>
        )}
      </div>

      {results.sections.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <SearchX className="h-8 w-8" strokeWidth={1.5} />
          {results.terms.length === 0 ? (
            <>
              <p className="mt-3 font-medium text-foreground">Nothing to search for in &ldquo;{results.query}&rdquo;</p>
              <p className="mt-1 text-sm">Try a longer or different word.</p>
            </>
          ) : (
            <>
              <p className="mt-3 font-medium text-foreground">Nothing matched &ldquo;{results.query}&rdquo;</p>
              <p className="mt-1 text-sm">Try fewer or different words{semantic ? "" : ", or turn on semantic search"}.</p>
            </>
          )}
        </div>
      )}

      {results.sections.map((s) => <SectionBlock key={s.key} section={s} terms={results.terms} />)}
      <SemanticNote state={results.semantic} />
    </div>
  )
}
