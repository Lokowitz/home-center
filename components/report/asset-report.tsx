import { AssetImage } from "@/components/asset-image"
import { assetLabel } from "@/lib/assets"
import { averagePerMonth, categoryLabel, costPerMeter, sum, UNCATEGORIZED } from "@/lib/costs"
import { scheduleDue, type MileageIndex } from "@/lib/maintenance-due"
import type { ReportData, ReportRoom, ReportSchedule, ReportService, ReportWarranty } from "@/lib/report-server"
import type { ServiceCategory } from "@/app/generated/prisma/client"
import { Empty, SectionTitle } from "./report-parts"
import { HealthSummary } from "./health-summary"
import { getFormat } from "@/lib/regional-server"
import type { Formatter } from "@/lib/regional"
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from "@/lib/report-options"
import { paintLabel } from "@/lib/rooms"
import { warrantyToday } from "@/lib/llm/warranty-status"

// The printable asset report. A document, not a screen: one column, real
// headings, tables where things line up, and no interactive affordance anywhere
// inside it — the only control lives outside the sheet and is hidden in print.

/** `options` only applies to a medical summary; other reports print everything. */
export async function AssetReport({ data, options = DEFAULT_REPORT_OPTIONS }: { data: ReportData; options?: ReportOptions }) {
  const fmt = await getFormat()
  const { asset, services, warranties, schedules, costRows, generatedAt } = data
  const isPerson = asset.type === "PERSON"

  const lifetime = sum(costRows)
  const perMeter = asset.meterUnit ? costPerMeter(costRows) : null
  const now = generatedAt
  const today = warrantyToday(now)
  const activeWarranties = warranties.filter(
    (w) => w.expirationDate != null && new Date(w.expirationDate) >= today
  ).length

  // Mileage index for the due calculations, built from the asset itself rather
  // than the whole fleet: a report is about one thing.
  const mileage: MileageIndex =
    asset.type === "VEHICLE" && asset.currentMeter != null
      ? new Map([[asset.id, { value: asset.currentMeter, unit: asset.meterUnit ?? "MILES" }]])
      : new Map()

  const first = services[0]?.date ?? null
  const last = services[services.length - 1]?.date ?? null

  return (
    <article className="report-doc report-sheet mx-auto w-full max-w-[8.5in] px-4 max-sm:break-words py-9 shadow-sm sm:px-10 print:shadow-none">
      <Masthead
        title={asset.name}
        subtitle={asset.subtitle}
        kind={isPerson ? "Medical summary" : assetLabel[asset.type]}
        generatedAt={generatedAt}
        fmt={fmt}
        image={
          asset.imageFilename ? (
            <AssetImage
              assetType={asset.type}
              assetId={asset.id}
              imageFilename={asset.imageFilename}
              alt={asset.name}
              className="aspect-[4/3] w-full rounded-md border"
              // The border is part of the document's furniture, so it has to
              // survive the print pipeline like every other rule here.
              data-print-color=""
            />
          ) : null
        }
      >
        <SectionTitle>{isPerson ? "Personal details" : "Asset details"}</SectionTitle>
        <dl className="mt-3">
          {asset.details.map((row) => (
            <div
              key={row.label}
              className="flex gap-4 border-b py-[5px] text-[10pt] last:border-b-0"
              style={{ borderColor: "var(--rule)" }}
            >
              <dt className="w-36 shrink-0" style={{ color: "var(--ink-soft)" }}>
                {row.label}
              </dt>
              <dd className="min-w-0 flex-1 font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Masthead>
      {data.health && <HealthSummary health={data.health} now={now} options={options} fmt={fmt} />}
      {data.rooms.length > 0 && <Rooms rooms={data.rooms} fmt={fmt} />}

      {(!isPerson || options.expense) && (
      <section className="report-section mt-7">
        <SectionTitle>Summary</SectionTitle>
        <div
          className="mt-3 grid grid-cols-2 gap-px sm:grid-cols-4 overflow-hidden rounded-md border"
          style={{ borderColor: "var(--rule-strong)", background: "var(--rule)" }}
          data-print-color=""
        >
          <Stat label={isPerson ? "Medical spend to date" : "Service cost to date"} value={fmt.money(lifetime)} />
          <Stat
            label={isPerson ? "Visits" : "Service records"}
            value={String(services.length)}
            note={
              first && last
                ? `${new Date(first).getUTCFullYear()}–${new Date(last).getUTCFullYear()}`
                : undefined
            }
          />
          {isPerson ? (
            <Stat
              label="Active conditions"
              value={String(data.health?.person.conditions.filter((c) => c.status !== "RESOLVED").length ?? 0)}
            />
          ) : (
            <Stat
              label="Warranties"
              value={`${activeWarranties} active`}
              note={warranties.length > activeWarranties ? `${warranties.length} on file` : undefined}
            />
          )}
          {perMeter != null ? (
            <Stat
              label={`Cost per ${fmt.meterWord(asset.meterUnit!)}`}
              value={fmt.moneyRate(perMeter)}
            />
          ) : asset.purchasePrice != null ? (
            <Stat
              label="Total owned cost"
              value={fmt.money(asset.purchasePrice + lifetime)}
              note="purchase + service"
            />
          ) : (
            <Stat
              label="Average per month"
              value={fmt.money(averagePerMonth(costRows, now))}
              note="since first record"
            />
          )}
        </div>
      </section>
      )}

      {asset.notes ? (
        <section className="report-section report-break-avoid mt-7">
          <SectionTitle>Notes</SectionTitle>
          <p className="mt-2 whitespace-pre-wrap text-[10pt]" style={{ color: "var(--ink-soft)" }}>
            {asset.notes}
          </p>
        </section>
      ) : null}

      {(!isPerson || options.visits !== "off") && (
        <ServiceHistory services={services} asset={data.asset} total={lifetime} showCost={!isPerson || options.visits === "cost"} fmt={fmt} />
      )}
      {!isPerson && <Warranties warranties={warranties} now={now} fmt={fmt} />}
      {(!isPerson || options.reminders) && (
        <Maintenance schedules={schedules} mileage={mileage} asset={data.asset} now={now} fmt={fmt} />
      )}

      <footer
        className="mt-9 border-t pt-3 text-[8.5pt]"
        style={{ borderColor: "var(--rule-strong)", color: "var(--ink-faint)" }}
        data-print-color=""
      >
        <div className="flex justify-between gap-6">
          <span className="min-w-0 break-words">
            {asset.name} · {isPerson ? "medical summary" : `${assetLabel[asset.type]} report`} · generated{" "}
            {`${fmt.date(generatedAt, { long: true })} ${fmt.time(generatedAt)}`}
          </span>
          <span>HomeCenter</span>
        </div>
        {!isPerson && (
          <p className="mt-1.5">
            {services.length} service record{services.length === 1 ? "" : "s"} ·{" "}
            {warranties.length} warrant{warranties.length === 1 ? "y" : "ies"} ·{" "}
            {schedules.length} maintenance schedule{schedules.length === 1 ? "" : "s"}.{" "}
            Attachments are named but not embedded; download them from the asset page.
          </p>
        )}
      </footer>
    </article>
  )
}

function Masthead({
  title,
  subtitle,
  kind,
  generatedAt,
  fmt,
  image,
  children,
}: {
  title: string
  subtitle: string | null
  kind: string
  generatedAt: Date
  fmt: Formatter
  image: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <header>
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-4 border-b pb-2 text-[8.5pt] font-semibold uppercase tracking-[0.14em]"
        style={{ borderColor: "var(--rule-strong)", color: "var(--ink-faint)" }}
        data-print-color=""
      >
        <span>HomeCenter · {kind} report</span>
        <span>{fmt.date(generatedAt, { long: true })}</span>
      </div>
      {/* The photo sits beside the title, not below it, so it uses the room the
          masthead leaves free; the details run on underneath the title. */}
      <div className="report-section mt-5 grid grid-cols-1 gap-7 sm:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          <h1 className="break-words font-heading text-[26pt] font-semibold leading-none">{title}</h1>
          {subtitle ? (
            <p className="mt-2 text-[12pt]" style={{ color: "var(--ink-soft)" }}>
              {subtitle}
            </p>
          ) : null}
          <div className="mt-6">{children}</div>
        </div>
        <div>{image}</div>
      </div>
    </header>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="px-3 py-2.5" style={{ background: "var(--paper)" }} data-print-color="">
      <div className="text-[13pt] font-semibold leading-tight">{value}</div>
      <div className="mt-1 text-[8pt] uppercase tracking-wide" style={{ color: "var(--ink-faint)" }}>
        {label}
      </div>
      {note ? (
        <div className="mt-0.5 text-[8pt]" style={{ color: "var(--ink-faint)" }}>
          {note}
        </div>
      ) : null}
    </div>
  )
}

/// Category is shown as a coloured dot beside its name, never as colour alone —
/// the report has to survive a monochrome printer, and the name is what does the
/// work there.
function CategoryTag({ category }: { category: ServiceCategory | null }) {
  const key = category ?? UNCATEGORIZED
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[9pt]">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: `var(--cat-${key})` }}
        data-print-color=""
      />
      {categoryLabel(key)}
    </span>
  )
}

function Files({ attachments }: { attachments: { id: string; originalName: string }[] }) {
  if (attachments.length === 0) return null
  return (
    <div className="mt-1 text-[8.5pt]" style={{ color: "var(--ink-faint)" }}>
      Files: {attachments.map((a) => a.originalName).join(", ")}
    </div>
  )
}

function Rooms({ rooms, fmt }: { rooms: ReportRoom[]; fmt: Formatter }) {
  return (
    <section className="report-section mt-7">
      <SectionTitle>Rooms</SectionTitle>
      <ul className="mt-1">
        {rooms.map((r) => {
          const size = [r.area != null ? fmt.area(r.area) : null, r.dimensions].filter(Boolean).join(" · ")
          const flooring = [
            r.flooringType,
            r.flooringProduct,
            r.flooringInstalled ? `installed ${fmt.date(r.flooringInstalled, { utc: true })}` : null,
          ]
            .filter(Boolean)
            .join(" · ")

          return (
            <li key={r.id} className="report-break-avoid border-t py-3" style={{ borderColor: "var(--rule)" }}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-semibold">{r.name}</span>
                {r.level ? (
                  <span className="text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                    {r.level}
                  </span>
                ) : null}
              </div>
              {size ? (
                <div className="mt-1 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                  Size: {size}
                </div>
              ) : null}
              {flooring ? (
                <div className="mt-0.5 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                  Flooring: {flooring}
                </div>
              ) : null}
              {r.paints.map((p) => (
                <div key={p.id} className="mt-0.5 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                  {paintLabel(p)}
                </div>
              ))}
              {r.notes ? (
                <p className="mt-1 whitespace-pre-wrap text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                  {r.notes}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ServiceHistory({
  services,
  asset,
  total,
  showCost,
  fmt,
}: {
  services: ReportService[]
  asset: ReportData["asset"]
  total: number
  showCost: boolean
  fmt: Formatter
}) {
  const showMeter = asset.type === "VEHICLE" && services.some((s) => s.mileageAtService != null)
  const unit = fmt.meterShort(asset.meterUnit ?? "MILES")

  return (
    <section className="report-section mt-7">
      <SectionTitle>{asset.type === "PERSON" ? "Visits & expenses" : "Service history"}</SectionTitle>
      {services.length === 0 ? (
        <Empty>{asset.type === "PERSON" ? "No visits have been recorded." : "No service has been recorded for this asset."}</Empty>
      ) : (
        <div className="max-sm:overflow-x-auto">
        <table className="mt-1 w-full border-collapse text-[10pt]">
          {/* Repeated at the top of every printed page by the browser, which is
              the one thing a table gives a long document that a list cannot. */}
          <thead>
            <tr
              className="text-[8pt] uppercase tracking-wide"
              style={{ color: "var(--ink-faint)" }}
            >
              <th className="w-[94px] py-2 pr-3 text-left font-semibold">Date</th>
              <th className="py-2 pr-3 text-left font-semibold">Service</th>
              <th className="w-[104px] py-2 pr-3 text-left font-semibold">Category</th>
              {showMeter ? (
                <th className="w-[84px] py-2 pr-3 text-right font-semibold">{unit}</th>
              ) : null}
              {showCost ? <th className="w-[84px] py-2 text-right font-semibold">Cost</th> : null}
            </tr>
          </thead>
          {services.map((s) => (
            <tbody key={s.id} className="report-break-avoid">
              <tr className="border-t align-top" style={{ borderColor: "var(--rule)" }}>
                <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums" style={{ color: "var(--ink-soft)" }}>
                  {fmt.date(s.date, { utc: true })}
                </td>
                <td className="py-2.5 pr-3">
                  <div className="font-semibold">{s.title}</div>
                  {s.vendor ? (
                    <div className="text-[9pt]" style={{ color: "var(--ink-soft)" }}>
                      {s.vendor}
                    </div>
                  ) : null}
                  {s.description ? (
                    <p className="mt-1 whitespace-pre-wrap text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                      {s.description}
                    </p>
                  ) : null}
                  <Files attachments={s.attachments} />
                </td>
                <td className="py-2.5 pr-3">
                  <CategoryTag category={s.category} />
                </td>
                {showMeter ? (
                  <td className="py-2.5 pr-3 text-right tabular-nums" style={{ color: "var(--ink-soft)" }}>
                    {s.mileageAtService != null ? s.mileageAtService.toLocaleString() : "—"}
                  </td>
                ) : null}
                {showCost ? (
                  <td className="py-2.5 text-right font-medium tabular-nums">
                    {s.cost != null ? fmt.money(s.cost) : "—"}
                  </td>
                ) : null}
              </tr>
            </tbody>
          ))}
          {showCost ? (
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: "var(--rule-strong)" }}>
                <td className="py-2.5 text-[9pt] font-semibold uppercase tracking-wide" colSpan={showMeter ? 4 : 3}>
                  Total
                </td>
                <td className="py-2.5 text-right font-semibold tabular-nums">{fmt.money(total)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
        </div>
      )}
    </section>
  )
}

function Warranties({ warranties, now, fmt }: { warranties: ReportWarranty[]; now: Date; fmt: Formatter }) {
  const today = warrantyToday(now)
  return (
    <section className="report-section mt-7">
      <SectionTitle>Warranties</SectionTitle>
      {warranties.length === 0 ? (
        <Empty>No warranties are on file for this asset.</Empty>
      ) : (
        <ul className="mt-1">
          {warranties.map((w) => {
            const expires = w.expirationDate ? new Date(w.expirationDate) : null
            const active = expires != null && expires >= today
            const remaining = expires ? remainingLife(expires, today) : null
            const contact = [w.vendor, w.vendorPhone, w.vendorEmail].filter(Boolean).join(" · ")

            return (
              <li
                key={w.id}
                className="report-break-avoid border-t py-3"
                style={{ borderColor: "var(--rule)" }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-semibold">{w.productName}</span>
                  <StatusTag
                    tone={active ? "good" : "spent"}
                    label={
                      expires == null
                        ? "No expiry recorded"
                        : active
                          ? `Active · ${remaining} left`
                          : "Expired"
                    }
                  />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-6 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                  <span>
                    Purchased{" "}
                    {w.purchaseDate
                      ? fmt.date(w.purchaseDate, { utc: true })
                      : "—"}
                  </span>
                  <span>
                    Expires{" "}
                    {expires ? fmt.date(expires, { utc: true }) : "—"}
                  </span>
                </div>
                {contact ? (
                  <div className="mt-0.5 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                    {contact}
                  </div>
                ) : null}
                {w.notes ? (
                  <p className="mt-1 whitespace-pre-wrap text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                    {w.notes}
                  </p>
                ) : null}
                <Files attachments={w.attachments} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Maintenance({
  schedules,
  mileage,
  asset,
  now,
  fmt,
}: {
  schedules: ReportSchedule[]
  mileage: MileageIndex
  asset: ReportData["asset"]
  now: Date
  fmt: Formatter
}) {
  const unit = fmt.meterShort(asset.meterUnit ?? "MILES")

  return (
    <section className="report-section mt-7">
      <SectionTitle>{asset.type === "PERSON" ? "Health reminders" : "Maintenance schedule"}</SectionTitle>
      {schedules.length === 0 ? (
        <Empty>{asset.type === "PERSON" ? "No health reminders are scheduled." : "No recurring maintenance is scheduled for this asset."}</Empty>
      ) : (
        <ul className="mt-1">
          {schedules.map((m) => {
            const due = scheduleDue(
              {
                assetType: asset.type,
                assetId: asset.id,
                nextDueDate: m.nextDueDate,
                nextDueMileage: m.nextDueMileage,
                reminderDaysBefore: m.reminderDaysBefore,
                reminderMilesBefore: m.reminderMilesBefore,
              },
              mileage,
              now
            )
            const interval = [
              m.intervalDays ? `every ${m.intervalDays} days` : null,
              m.intervalMiles ? `every ${m.intervalMiles.toLocaleString()} ${unit}` : null,
            ]
              .filter(Boolean)
              .join(" or ")

            return (
              <li
                key={m.id}
                className="report-break-avoid border-t py-3"
                style={{ borderColor: "var(--rule)" }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-semibold">
                    {m.title}
                    {!m.isActive ? (
                      <span className="ml-2 text-[9pt] font-normal" style={{ color: "var(--ink-faint)" }}>
                        (inactive)
                      </span>
                    ) : null}
                  </span>
                  {m.isActive ? (
                    <StatusTag
                      tone={due.overdue ? "bad" : due.dueSoon ? "warn" : "good"}
                      label={dueWording(due, unit)}
                    />
                  ) : null}
                </div>
                {interval ? (
                  <div className="mt-1 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                    Interval: {interval}
                  </div>
                ) : null}
                <div className="mt-0.5 flex flex-wrap gap-x-6 text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                  <span>
                    Last completed{" "}
                    {m.lastCompletedDate
                      ? fmt.date(m.lastCompletedDate, { utc: true })
                      : "—"}
                    {m.lastCompletedMileage != null
                      ? ` at ${m.lastCompletedMileage.toLocaleString()} ${unit}`
                      : ""}
                  </span>
                  <span>
                    Next due{" "}
                    {m.nextDueDate
                      ? fmt.date(m.nextDueDate, { utc: true })
                      : "—"}
                    {m.nextDueMileage != null ? ` / ${m.nextDueMileage.toLocaleString()} ${unit}` : ""}
                  </span>
                </div>
                {m.description ? (
                  <p className="mt-1 whitespace-pre-wrap text-[9.5pt]" style={{ color: "var(--ink-soft)" }}>
                    {m.description}
                  </p>
                ) : null}
                <Files attachments={m.attachments} />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/// Days are the right unit for a fortnight and the wrong one for a thirty-year
/// roof warranty: "9,315 days left" is a number nobody converts. The unit grows
/// with the span so the figure stays one a reader can picture.
function remainingLife(expires: Date, now: Date): string {
  const days = Math.ceil((expires.getTime() - now.getTime()) / 86400000)
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`
  const months = Math.round(days / 30.44)
  if (months < 24) return `${months} months`
  const years = Math.floor(days / 365.25)
  const leftoverMonths = Math.round((days - years * 365.25) / 30.44)
  return leftoverMonths >= 1 ? `${years} yr ${leftoverMonths} mo` : `${years} years`
}

function dueWording(due: ReturnType<typeof scheduleDue>, unit: string): string {
  if (due.overdue) {
    if (due.reason === "mileage" && due.milesLeft != null) {
      return `Overdue by ${Math.abs(due.milesLeft).toLocaleString()} ${unit}`
    }
    return due.daysLeft != null ? `Overdue by ${Math.abs(due.daysLeft)} days` : "Overdue"
  }
  if (due.dueSoon) {
    if (due.reason === "mileage" && due.milesLeft != null) {
      return `Due in ${due.milesLeft.toLocaleString()} ${unit}`
    }
    return due.daysLeft != null ? `Due in ${due.daysLeft} days` : "Due soon"
  }
  if (due.daysLeft != null) return `Due in ${due.daysLeft} days`
  if (due.milesLeft != null) return `Due in ${due.milesLeft.toLocaleString()} ${unit}`
  return "Scheduled"
}

/// Status is a word first and a colour second, so the report still says what it
/// means printed in black and white.
function StatusTag({ tone, label }: { tone: "good" | "warn" | "bad" | "spent"; label: string }) {
  const color =
    tone === "bad" ? "#b3261e" : tone === "warn" ? "#8a5a00" : tone === "good" ? "#1a6b45" : "#6b7280"
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full border px-2 py-[2px] text-[8.5pt] font-medium"
      style={{ color, borderColor: color }}
      data-print-color=""
    >
      {label}
    </span>
  )
}
