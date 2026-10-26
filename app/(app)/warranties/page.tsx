import { getFormat } from "@/lib/regional-server"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { SearchBar } from "@/components/search-bar"
import Link from "next/link"
import { Suspense } from "react"
import { loadAssetIndex } from "@/lib/assets-server"
import { assetHref, assetIcon } from "@/lib/assets"
import { UrlSortHead, UrlPaginationBar } from "@/components/ui/url-table"
import { parseTableParams, pageCountOf, withParams, type SortMap } from "@/lib/table-params"
import type { Prisma } from "@/app/generated/prisma/client"
import { ownedWhere } from "@/lib/features"
import { loadFeatures } from "@/lib/features-server"
import { filteredEmptyText, ownedScopeWhere } from "@/lib/property-filter"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { warrantyState, warrantyToday } from "@/lib/llm/warranty-status"

const WARN_DAYS = 60
const DEFAULT_SORT = "expires"
const DEFAULT_DIR = "asc"

// "status" is derived in JS from expirationDate, so there is no status column to
// order by — but status runs in lockstep with the date (expired < expiring <
// active), so the token maps onto expirationDate and the two agree exactly.
const SORTABLE: SortMap<Prisma.WarrantyOrderByWithRelationInput> = {
  product: (dir) => [{ productName: dir }],
  vendor: (dir) => [{ vendor: { sort: dir, nulls: "last" } }],
  expires: (dir) => [{ expirationDate: { sort: dir, nulls: "last" } }],
  status: (dir) => [{ expirationDate: { sort: dir, nulls: "last" } }],
}

function warrantyStatus(expirationDate: Date | null) {
  if (!expirationDate) return null
  // Whole days, so a warranty ending today reads "Today" rather than "Expired".
  // The status filter is SQL-side (expirationDate < start of today), so the two
  // have to agree on the same day.
  const { state, daysLeft } = warrantyState(new Date(expirationDate), new Date(), WARN_DAYS)
  if (state === "expired") return { label: "Expired", variant: "destructive" as const }
  if (state === "expiring") return { label: daysLeft === 0 ? "Today" : `${daysLeft}d left`, variant: "secondary" as const }
  return { label: "Active", variant: "outline" as const }
}

export default async function WarrantiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const fmt = await getFormat()
  const params = await searchParams
  const q = typeof params.q === "string" ? params.q : undefined
  const status = typeof params.status === "string" ? params.status : undefined

  const now = warrantyToday(new Date())
  const warnCutoff = new Date(now.getTime() + WARN_DAYS * 86400000)

  const { page, per, skip, take, orderBy } = parseTableParams({
    searchParams: params,
    sortable: SORTABLE,
    defaultSort: DEFAULT_SORT,
    defaultDir: DEFAULT_DIR,
    tiebreaker: { id: "asc" },
  })

  // Status used to be recomputed in JS after loading every warranty, which meant
  // the filter never reached the database. Expressed as date ranges it does.
  const statusWhere: Prisma.WarrantyWhereInput =
    status === "expired" ? { expirationDate: { lt: now } }
    : status === "expiring" ? { expirationDate: { gte: now, lte: warnCutoff } }
    : status === "active" ? { expirationDate: { gt: warnCutoff } }
    : {}

  const scope = await loadPropertyScope()
  const owned: Prisma.WarrantyWhereInput = { AND: [ownedWhere(await loadFeatures()), ownedScopeWhere(scope)] }
  const where: Prisma.WarrantyWhereInput = {
    AND: [
      owned,
      statusWhere,
      q ? { OR: [{ productName: { contains: q } }, { vendor: { contains: q } }] } : {},
    ],
  }

  const [warranties, total, expiringSoon, assets] = await Promise.all([
    prisma.warranty.findMany({ where, orderBy, skip, take }),
    prisma.warranty.count({ where }),
    // Headline stat ignores the search and status filters (it follows the property filter).
    prisma.warranty.count({ where: { AND: [owned, { expirationDate: { gte: now, lte: warnCutoff } }] } }),
    loadAssetIndex(),
  ])

  const pageCount = pageCountOf(total, per)
  if (page > pageCount) redirect(`/warranties${withParams(params, { page: pageCount === 1 ? undefined : pageCount })}`)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Warranties</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total} warrant{total !== 1 ? "ies" : "y"}
          {expiringSoon > 0 && (
            <span className="ml-2 text-amber-700 dark:text-amber-400 font-medium">· {expiringSoon} expiring soon</span>
          )}
        </p>
      </div>

      <Suspense>
        <SearchBar
          placeholder="Search coverage, vendor…"
          filters={[{ key: "status", placeholder: "All statuses", options: [{ value: "active", label: "Active" }, { value: "expiring", label: "Expiring soon" }, { value: "expired", label: "Expired" }] }]}
        />
      </Suspense>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {scope && !q && !status ? (
            <p className="font-medium">{filteredEmptyText(scope)}</p>
          ) : (
            <>
              <p className="font-medium">No warranties {q || status ? "match those filters" : "yet"}</p>
              <p className="text-sm mt-1">
                {q || status ? "Try clearing the search or filter." : "Add warranties from a property, vehicle, or equipment detail page."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Asset</th>
                  <Suspense>
                    <UrlSortHead column="product" label="Coverage" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                  <Suspense>
                    <UrlSortHead column="vendor" label="Vendor" className="hidden sm:table-cell" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                  <Suspense>
                    <UrlSortHead column="expires" label="Expires" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                  <Suspense>
                    <UrlSortHead column="status" label="Status" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                </tr>
              </thead>
              <tbody className="divide-y">
                {warranties.map((w) => {
                  const assetName = assets.assetName(w.assetType, w.assetId)
                  const AssetIcon = assetIcon[w.assetType]
                  const st = warrantyStatus(w.expirationDate)

                  return (
                    <tr key={w.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={assetHref(w.assetType, w.assetId)} className="flex items-center gap-1.5 hover:underline">
                          <AssetIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {assetName ?? <span className="text-muted-foreground italic">Unknown</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link href={`${assetHref(w.assetType, w.assetId)}?tab=warranties&open=${w.id}`} className="hover:underline">
                          {w.productName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{w.vendor ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {w.expirationDate ? fmt.date(w.expirationDate, { utc: true }) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {st ? <Badge variant={st.variant}>{st.label}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Suspense>
            <UrlPaginationBar page={page} pageCount={pageCount} total={total} per={per} label="warranties" />
          </Suspense>
        </div>
      )}
    </div>
  )
}
