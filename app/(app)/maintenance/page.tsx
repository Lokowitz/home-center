import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { Suspense } from "react"
import { AlertTriangle, Clock, CheckCircle2, AlarmClockOff } from "lucide-react"
import { loadAssetIndex } from "@/lib/assets-server"
import { assetHref, assetIcon } from "@/lib/assets"
import { UrlSortHead, UrlPaginationBar } from "@/components/ui/url-table"
import { parseTableParams, pageCountOf, withParams, type SortMap } from "@/lib/table-params"
import { getFormat } from "@/lib/regional-server"
import type { Formatter } from "@/lib/regional"
import { scheduleDue, dueBadge, isSnoozed, type Due } from "@/lib/maintenance-due"
import { loadVehicleMileage } from "@/lib/maintenance-due-server"
import type { AssetType, Prisma } from "@/app/generated/prisma/client"
import { ownedWhere } from "@/lib/features"
import { loadFeatures } from "@/lib/features-server"
import { isDoneOnce } from "@/lib/maintenance-schedule"
import { filteredEmptyText, ownedScopeWhere } from "@/lib/property-filter"
import { loadPropertyScope } from "@/lib/property-filter-server"

const DEFAULT_SORT = "nextDue"
const DEFAULT_DIR = "asc"

const reminderTab = (assetType: AssetType) => (assetType === "PERSON" ? "reminders" : "maintenance")

// "status" still sorts by nextDueDate. That orders date-driven rows correctly,
// but a row that is overdue only on mileage sorts by its date, so it won't lead
// the list. Fixing that means ordering in JS across the whole table rather than
// in SQL per page — deliberately left alone here.
const SORTABLE: SortMap<Prisma.MaintenanceScheduleOrderByWithRelationInput> = {
  task: (dir) => [{ title: dir }],
  nextDue: (dir) => [{ nextDueDate: { sort: dir, nulls: "last" } }],
  lastDone: (dir) => [{ lastCompletedDate: { sort: dir, nulls: "last" } }],
  status: (dir) => [{ nextDueDate: { sort: dir, nulls: "last" } }],
}

function statusOf(due: Due, snoozedUntil: Date | null, now: Date, fmt: Formatter) {
  if (isSnoozed({ snoozedUntil }, now)) {
    return { label: `Snoozed to ${fmt.date(snoozedUntil!)}`, variant: "outline" as const, icon: AlarmClockOff }
  }
  const badge = dueBadge(due, true, fmt)!
  const icon = due.overdue ? AlertTriangle : due.dueSoon ? Clock : CheckCircle2
  return { ...badge, label: badge.label === "OK" ? "Active" : badge.label, icon }
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const fmt = await getFormat()
  const now = new Date()

  const { page, per, skip, take, orderBy } = parseTableParams({
    searchParams: params,
    sortable: SORTABLE,
    defaultSort: DEFAULT_SORT,
    defaultDir: DEFAULT_DIR,
    tiebreaker: { id: "asc" },
  })

  const scope = await loadPropertyScope()
  const where: Prisma.MaintenanceScheduleWhereInput = { isActive: true, ...ownedWhere(await loadFeatures()), ...ownedScopeWhere(scope) }

  const [schedules, total, statusRows, mileage, assets] = await Promise.all([
    prisma.maintenanceSchedule.findMany({ where, orderBy, skip, take }),
    prisma.maintenanceSchedule.count({ where }),
    // Both headline counts compare a column against another column on the same
    // row — nextDueDate against reminderDaysBefore, nextDueMileage against the
    // vehicle's odometer — which SQL can't express here. Pull the six small
    // columns for every active row and finish in JS; the counts have to reflect
    // all of them, not just the page being shown.
    prisma.maintenanceSchedule.findMany({
      where,
      select: {
        assetType: true, assetId: true, nextDueDate: true, nextDueMileage: true,
        reminderDaysBefore: true, reminderMilesBefore: true, snoozedUntil: true,
      },
    }),
    loadVehicleMileage(),
    loadAssetIndex(),
  ])

  let overdue = 0
  let dueSoon = 0
  for (const row of statusRows) {
    // Snoozed rows are listed, but someone has already put them off.
    if (isSnoozed(row, now)) continue
    const due = scheduleDue(row, mileage, now)
    if (due.overdue) overdue++
    else if (due.dueSoon) dueSoon++
  }

  const pageCount = pageCountOf(total, per)
  if (page > pageCount) redirect(`/maintenance${withParams(params, { page: pageCount === 1 ? undefined : pageCount })}`)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Maintenance</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {total} active schedule{total !== 1 ? "s" : ""}
          {overdue > 0 && <span className="ml-2 text-destructive font-medium">· {overdue} overdue</span>}
          {dueSoon > 0 && <span className="ml-2 text-amber-700 dark:text-amber-400 font-medium">· {dueSoon} due soon</span>}
        </p>
      </div>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {scope ? (
            <p className="font-medium">{filteredEmptyText(scope)}</p>
          ) : (
            <>
              <p className="font-medium">No maintenance schedules</p>
              <p className="text-sm mt-1">Add schedules from a property, vehicle, or equipment detail page.</p>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <Suspense>
                    <UrlSortHead column="status" label="Status" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                  <th scope="col" className="text-left font-medium px-4 py-2.5">Asset</th>
                  <Suspense>
                    <UrlSortHead column="task" label="Task" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                  <Suspense>
                    <UrlSortHead column="nextDue" label="Next Due" className="hidden sm:table-cell" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                  <th scope="col" className="text-left font-medium px-4 py-2.5 hidden md:table-cell">Est. cost</th>
                  <Suspense>
                    <UrlSortHead column="lastDone" label="Last Done" className="hidden md:table-cell" initialDir="desc" defaultSort={DEFAULT_SORT} defaultDir={DEFAULT_DIR} />
                  </Suspense>
                </tr>
              </thead>
              <tbody className="divide-y">
                {schedules.map((s) => {
                  const assetName = assets.assetName(s.assetType, s.assetId)
                  const AssetIcon = assetIcon[s.assetType]
                  const status = isDoneOnce(s)
                    ? { label: "Done", variant: "outline" as const, icon: CheckCircle2 }
                    : statusOf(scheduleDue(s, mileage, now), s.snoozedUntil, now, fmt)
                  const StatusIcon = status.icon

                  return (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={assetHref(s.assetType, s.assetId)} className="flex items-center gap-1.5 hover:underline">
                          <AssetIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {assetName ?? <span className="text-muted-foreground italic">Unknown</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link href={`${assetHref(s.assetType, s.assetId)}?tab=${reminderTab(s.assetType)}&open=${s.id}`} className="hover:underline">
                          {s.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {s.nextDueDate ? fmt.date(s.nextDueDate, { utc: true }) : isDoneOnce(s) ? "Done" : "—"}
                        {s.nextDueMileage != null && <span className="block text-xs">{s.nextDueMileage.toLocaleString()} {fmt.meterShort(mileage.get(s.assetId)?.unit ?? "MILES")}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {s.estimatedCost != null ? fmt.money(s.estimatedCost) : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                        {s.lastCompletedDate ? fmt.date(s.lastCompletedDate, { utc: true }) : "Never"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Suspense>
            <UrlPaginationBar page={page} pageCount={pageCount} total={total} per={per} label="schedules" />
          </Suspense>
        </div>
      )}
    </div>
  )
}
