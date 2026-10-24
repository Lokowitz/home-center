import { BookOpen } from "lucide-react"

export type ManualLinkTarget = { href: string; label: string; title: string } | null | undefined

/** "Manual, p. 42": opens the reminder's linked file (at that page for a PDF) in a new tab. */
export function ManualLink({ manual, className = "" }: { manual: ManualLinkTarget; className?: string }) {
  if (!manual) return null
  return (
    <a
      href={manual.href}
      target="_blank"
      rel="noopener noreferrer"
      title={manual.title}
      // The row opens the edit form on click; this link must not.
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline ${className}`}
    >
      <BookOpen className="h-3 w-3" />
      {manual.label}
    </a>
  )
}
