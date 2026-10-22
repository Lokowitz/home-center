import Link from "next/link"
import {
  Activity, CalendarClock, DoorOpen, ExternalLink, FileText, Pill, ShieldCheck, Sparkles, Stethoscope, Syringe, TextSearch,
  TriangleAlert, Umbrella, UserRound, Wrench, NotebookPen,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AssetImage } from "@/components/asset-image"
import { assetLabel } from "@/lib/assets"
import { highlight } from "@/lib/search/query"
import type { AssetResult, AssetThumb, DocumentResult, Fact, MatchKind, RecordKind, RecordResult } from "@/lib/search/types"
import { cn } from "@/lib/utils"

// Cards for /search. Each card's title link stretches over the whole card
// (after:inset-0); the owner and file links sit above it (relative z-10) so
// they stay clickable without nesting anchors.

export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((s, i) =>
        s.match ? (
          // Padded and rounded only where the match meets a space or punctuation, so "car|pet" still reads as one word.
          <mark
            key={i}
            className={cn(
              "rounded-sm bg-primary/15 px-0.5 text-foreground",
              s.joinsPrev && "rounded-l-none pl-0",
              s.joinsNext && "rounded-r-none pr-0"
            )}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  )
}

const cardBase =
  "group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-card-foreground shadow-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring/50"
const stretched = "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"

function FactList({ facts, className }: { facts: Fact[]; className?: string }) {
  if (!facts.length) return null
  return (
    <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs", className)}>
      {facts.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd className="truncate font-medium tabular-nums" title={f.value}>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function OwnerChip({ owner }: { owner: AssetThumb }) {
  return (
    <Link
      href={owner.href}
      className="relative z-10 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-background py-0.5 pl-0.5 pr-2 text-xs hover:bg-muted"
    >
      <AssetImage
        assetType={owner.type}
        assetId={owner.id}
        imageFilename={owner.imageFilename}
        alt={owner.name}
        className="h-5 w-5 shrink-0 overflow-hidden rounded-full text-[8px] font-medium [&_svg]:h-3 [&_svg]:w-3"
      />
      <span className="truncate">{owner.name}</span>
      <span className="text-muted-foreground">· {assetLabel[owner.type]}</span>
    </Link>
  )
}

/** Marks a result found by meaning, or one that only has the search words inside longer words. */
function MatchBadge({ matchedBy, className }: { matchedBy: MatchKind | undefined; className?: string }) {
  if (matchedBy === "semantic") {
    return (
      <Badge variant="outline" className={cn("gap-1", className)} title="Related by meaning, not by your search words">
        <Sparkles className="h-3 w-3" /> Semantic
      </Badge>
    )
  }
  if (matchedBy === "partial") {
    return (
      <Badge
        variant="outline"
        className={cn("gap-1 border-dashed text-muted-foreground", className)}
        title="Not every search word appears here as a whole word, e.g. “car” inside “carpet”"
      >
        <TextSearch className="h-3 w-3" /> Partial match
      </Badge>
    )
  }
  return null
}

export function AssetCard({ item, terms }: { item: AssetResult; terms: string[] }) {
  return (
    <article className={cardBase}>
      <div className="relative">
        <AssetImage
          assetType={item.type}
          assetId={item.id}
          imageFilename={item.imageFilename}
          alt={item.name}
          className="h-40 w-full text-2xl font-semibold"
        />
        <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          {item.badge ? <Badge variant="secondary" className="bg-background/85 backdrop-blur-sm">{item.badge}</Badge> : <span />}
          <div className="flex flex-col items-end gap-1">
            {item.status && <Badge variant={item.status.tone} className="backdrop-blur-sm">{item.status.label}</Badge>}
            <MatchBadge matchedBy={item.matchedBy} className="bg-background/85 backdrop-blur-sm" />
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <Link href={item.href} className={cn("block truncate font-heading text-base font-semibold", stretched)}>
            <Highlighted text={item.name} terms={terms} />
          </Link>
          {item.subtitle && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
              <Highlighted text={item.subtitle} terms={terms} />
            </p>
          )}
        </div>
        <FactList facts={item.facts} className="mt-auto border-t border-border/60 pt-3" />
      </div>
    </article>
  )
}

const KIND: Record<RecordKind, { label: string; icon: React.ElementType; tint: string }> = {
  service: { label: "Service", icon: Wrench, tint: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  visit: { label: "Health visit", icon: Stethoscope, tint: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  maintenance: { label: "Maintenance", icon: CalendarClock, tint: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  warranty: { label: "Warranty", icon: ShieldCheck, tint: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  insurance: { label: "Insurance", icon: Umbrella, tint: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  provider: { label: "Provider", icon: UserRound, tint: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  condition: { label: "Condition", icon: Activity, tint: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  medication: { label: "Medication", icon: Pill, tint: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  allergy: { label: "Allergy", icon: TriangleAlert, tint: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  immunization: { label: "Immunization", icon: Syringe, tint: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  observation: { label: "Observation", icon: NotebookPen, tint: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
  room: { label: "Room", icon: DoorOpen, tint: "bg-lime-500/10 text-lime-700 dark:text-lime-300" },
}

export function RecordCard({ item, terms }: { item: RecordResult; terms: string[] }) {
  const kind = KIND[item.kind]
  const Icon = kind.icon
  return (
    <article className={cn(cardBase, "gap-3 p-4")}>
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", kind.tint)}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{kind.label}</span>
            {item.date && <span className="normal-case tracking-normal">· {item.date}</span>}
          </div>
          <Link href={item.href} className={cn("block truncate font-semibold leading-snug", stretched)}>
            <Highlighted text={item.title} terms={terms} />
          </Link>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.amount && <span className="text-sm font-semibold tabular-nums">{item.amount}</span>}
          {item.status && <Badge variant={item.status.tone}>{item.status.label}</Badge>}
          <MatchBadge matchedBy={item.matchedBy} />
        </div>
      </div>
      {item.subtitle && (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          <Highlighted text={item.subtitle} terms={terms} />
        </p>
      )}
      <FactList facts={item.facts} className="sm:grid-cols-3" />
      {(item.owner || item.people) && (
        <div className="mt-auto flex min-w-0 items-center gap-2 border-t border-border/60 pt-3">
          {item.owner ? (
            <OwnerChip owner={item.owner} />
          ) : (
            <span className="truncate text-xs text-muted-foreground">Covers {item.people}</span>
          )}
        </div>
      )}
    </article>
  )
}

export function DocumentCard({ item, terms }: { item: DocumentResult; terms: string[] }) {
  const href = item.record.href ?? item.fileHref
  return (
    <article className={cn(cardBase, "gap-3 p-4")}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Document</span>
            {item.pages && <span className="normal-case tracking-normal">· {item.pages} pages</span>}
          </div>
          {href ? (
            <Link href={href} className={cn("block truncate font-semibold leading-snug", stretched)}>
              <Highlighted text={item.fileName} terms={terms} />
            </Link>
          ) : (
            <p className="truncate font-semibold leading-snug">{item.fileName}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            On {item.record.type}: {item.record.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <MatchBadge matchedBy={item.matchedBy} />
          {item.fileHref && (
            <a
              href={item.fileHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${item.fileName}`}
              className="relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {item.passages.map((p, i) => (
          <blockquote key={i} className="border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground">
            {p.page && <span className="mr-1.5 text-xs font-medium text-foreground/70">p. {p.page}</span>}
            <Highlighted text={p.text} terms={terms} />
          </blockquote>
        ))}
      </div>
      {item.owner && (
        <div className="mt-auto flex min-w-0 items-center gap-2 border-t border-border/60 pt-3">
          <OwnerChip owner={item.owner} />
        </div>
      )}
    </article>
  )
}
