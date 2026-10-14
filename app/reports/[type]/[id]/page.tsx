import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"
import { AssetReport } from "@/components/report/asset-report"
import { PrintButton } from "@/components/report/print-button"
import { assetHref } from "@/lib/assets"
import { RegionalProvider } from "@/components/regional-provider"
import { loadRegionalSettings } from "@/lib/regional-server"
import { loadReport, parseAssetSegment } from "@/lib/report-server"

// Deliberately outside the (app) route group. That layout is a fixed-height
// shell with a sidebar and `overflow-hidden`, which is right for an application
// and wrong for a document that has to flow onto as many pages as it needs.
// Access is unchanged: proxy.ts gates every route that is not explicitly public.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; id: string }>
}): Promise<Metadata> {
  const { type, id } = await params
  const assetType = parseAssetSegment(type)
  if (!assetType) return { title: "Report" }
  const data = await loadReport(assetType, id)
  // The document title is what the browser puts on the printed page and offers
  // as the PDF's filename, so it is worth getting right.
  return { title: data ? `${data.asset.name} — ${assetType === "PERSON" ? "Medical Summary" : "Asset Report"}` : "Report" }
}

const OBSERVATION_CHOICES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
  { value: "none", label: "Leave out" },
] as const

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>
  searchParams: Promise<{ obs?: string }>
}) {
  const { type, id } = await params
  const { obs } = await searchParams
  const obsChoice = OBSERVATION_CHOICES.find((c) => c.value === obs)?.value ?? "90"
  const assetType = parseAssetSegment(type)
  if (!assetType) notFound()

  const data = await loadReport(assetType, id)
  if (!data) notFound()
  const regional = await loadRegionalSettings()

  return (
    <RegionalProvider value={regional}>
    <div className="min-h-svh bg-muted/40 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-5 flex w-full max-w-[8.5in] items-center justify-between gap-4 px-10">
        <Link
          href={assetHref(assetType, id)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to {data.asset.name}
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {assetType === "PERSON" && (
            <nav className="flex items-center gap-1 text-sm" aria-label="Observations to include">
              <span className="text-muted-foreground">Observations:</span>
              {OBSERVATION_CHOICES.map((c) => (
                <Link
                  key={c.value}
                  href={`?obs=${c.value}`}
                  aria-current={c.value === obsChoice ? "true" : undefined}
                  className={
                    c.value === obsChoice
                      ? "rounded px-2 py-0.5 font-medium bg-foreground text-background"
                      : "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
                  }
                >
                  {c.label}
                </Link>
              ))}
            </nav>
          )}
          <PrintButton />
        </div>
      </div>

      <AssetReport data={data} observationDays={obsChoice === "none" ? null : Number(obsChoice)} />
    </div>
    </RegionalProvider>
  )
}
