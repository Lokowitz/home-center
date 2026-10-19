import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"
import { AssetReport } from "@/components/report/asset-report"
import { PrintButton } from "@/components/report/print-button"
import { assetHref } from "@/lib/assets"
import { RegionalProvider } from "@/components/regional-provider"
import { loadRegionalSettings } from "@/lib/regional-server"
import { ReportOptionsPanel } from "@/components/report/report-options-panel"
import { parseReportOptions } from "@/lib/report-options"
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

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { type, id } = await params
  const options = parseReportOptions(await searchParams)
  const assetType = parseAssetSegment(type)
  if (!assetType) notFound()

  const data = await loadReport(assetType, id)
  if (!data) notFound()
  const regional = await loadRegionalSettings()

  return (
    <RegionalProvider value={regional}>
    <div className="min-h-svh bg-muted/40 pb-8 pt-4 print:bg-white print:py-0">
      {/* Pinned so they stay in reach while the document scrolls. The Back link
          sits over the sheet's left edge, not the window's, so the options
          panel can take the top-left corner; this row repeats the page's own
          column widths to line it up. */}
      <div className="no-print pointer-events-none fixed inset-x-0 top-4 z-20 flex justify-center gap-6">
        {assetType === "PERSON" && <div className="w-60 shrink-0" aria-hidden="true" />}
        <div className="w-full max-w-[8.5in]">
          <Link
            href={assetHref(assetType, id)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to {data.asset.name}
          </Link>
        </div>
      </div>
      <div className="no-print fixed right-4 top-4 z-20">
        <PrintButton />
      </div>

      <div className="mx-auto flex w-full items-start justify-center gap-6 print:block">
        {assetType === "PERSON" && <ReportOptionsPanel options={options} />}
        <div className="mt-12 w-full max-w-[8.5in] print:mt-0 print:max-w-none">
          <AssetReport data={data} options={options} />
        </div>
      </div>
    </div>
    </RegionalProvider>
  )
}
