"use client"

import { Fragment, useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronDown, Pencil, Trash2, CheckCircle2, AlertTriangle, Clock, Pause, Play, AlarmClockOff } from "lucide-react"
import { deleteMaintenanceSchedule, setMaintenanceScheduleActive } from "@/lib/actions/maintenance"
import { MaintenanceFormDialog } from "./maintenance-form-dialog"
import { CompleteDialog } from "./complete-dialog"
import { ManualLink } from "./manual-link"
import { resolveManual, type ManualOption } from "@/lib/manual-reference"
import { isDoneOnce, repeatsLabel } from "@/lib/maintenance-schedule"
import { SnoozeMenu } from "./snooze-menu"
import { remindersHref } from "./add-reminders-submit"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import { SortableTableHead } from "@/components/ui/sortable-table-head"
import { PaginationBar } from "@/components/ui/pagination-bar"
import { useClientTable, type Accessor } from "@/lib/use-client-table"
import type { SortDir } from "@/lib/table-params"
import { useFormat } from "@/components/regional-provider"
import type { Formatter } from "@/lib/regional"
import { scheduleDue, dueBadge, isSnoozed, type MileageIndex } from "@/lib/maintenance-due"
import type { Attachment, MaintenanceSchedule, MeterUnit, AssetType } from "@/app/generated/prisma/client"
import type { RoomOption } from "@/lib/rooms-server"

type MaintenanceScheduleWithAttachments = MaintenanceSchedule & { attachments: Attachment[] }

const ACCESSORS: Record<string, Accessor<MaintenanceScheduleWithAttachments>> = {
  title: (s) => s.title,
  status: (s) => (s.nextDueDate ? new Date(s.nextDueDate).getTime() : null),
  nextDue: (s) => (s.nextDueDate ? new Date(s.nextDueDate).getTime() : null),
  lastCompleted: (s) => (s.lastCompletedDate ? new Date(s.lastCompletedDate).getTime() : null),
}

const INITIAL_DIRS: Record<string, SortDir> = { lastCompleted: "desc" }

interface Props {
  schedules: MaintenanceScheduleWithAttachments[]
  assetId: string
  assetType: AssetType
  currentMileage?: number | null
  /** Vehicle's odometer unit. Defaults to miles. */
  meterUnit?: MeterUnit
  /** Property's equipment, for the Source column and the "For" picker when adding/editing. */
  equipment?: { id: string; name: string; roomId: string | null }[]
  propertyName?: string
  /** Rooms of the property, for the room select and the rows' room badges. Empty with Rooms off. */
  roomOptions?: RoomOption[]
  /** A new schedule's room (on an equipment page: the equipment's own). */
  defaultRoomId?: string | null
  /** Files a reminder may link as its manual: its asset's documents and its own files. */
  manualOptions?: ManualOption[]
  openId?: string
}

function getStatus(s: MaintenanceScheduleWithAttachments, currentMileage: number | null | undefined, meterUnit: MeterUnit, fmt: Formatter) {
  // One-entry index: this list only ever shows a single asset's schedules, and
  // the odometer is already on the page.
  const mileage: MileageIndex = new Map(
    currentMileage != null ? [[s.assetId, { value: currentMileage, unit: meterUnit }] as const] : []
  )
  // Paused and snoozed say so first: whatever the due date, they're on hold.
  if (!s.isActive) return { label: "Paused", variant: "outline" as const, icon: Pause }
  if (isSnoozed(s)) {
    return { label: `Snoozed to ${fmt.date(s.snoozedUntil!)}`, variant: "outline" as const, icon: AlarmClockOff }
  }
  const due = scheduleDue(s, mileage)
  const badge = dueBadge(due, s.nextDueDate != null || s.nextDueMileage != null, fmt)
  if (!badge) return null
  const icon = due.overdue ? AlertTriangle : due.dueSoon ? Clock : CheckCircle2
  return { ...badge, label: due.dueSoon ? "Due soon" : badge.label, icon }
}

// When the columns don't fit (a narrow window, the detail page's side column),
// the table scrolls inside its card; the actions stay pinned to the right edge
// so Complete and Snooze are never the part that's scrolled out of sight. Its
// background must be opaque (the row hover tint, mixed onto the card) or the
// scrolled cells would show through.
const stickyActions =
  "sticky right-0 z-[1] bg-card shadow-[-10px_0_10px_-10px_rgb(0_0_0/0.25)] [tr:hover_&]:bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))] [tr:has([aria-expanded=true])_&]:bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-card))]"

export function MaintenanceList({ schedules: initialSchedules, assetId, assetType, currentMileage, meterUnit = "MILES", equipment, propertyName, roomOptions = [], defaultRoomId, manualOptions, openId }: Props) {
  const router = useRouter()
  const fmt = useFormat()
  const [schedules, setSchedules] = useState(initialSchedules)
  const [prevInitialSchedules, setPrevInitialSchedules] = useState(initialSchedules)
  const [editing, setEditing] = useState<MaintenanceScheduleWithAttachments | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [completing, setCompleting] = useState<MaintenanceSchedule | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    const match = openId ? initialSchedules.find((s) => s.id === openId) : undefined
    if (match) { setEditing(match); setFormOpen(true) }
  }

  if (initialSchedules !== prevInitialSchedules) {
    setPrevInitialSchedules(initialSchedules)
    setSchedules(initialSchedules)
  }

  const table = useClientTable({
    rows: schedules,
    accessors: ACCESSORS,
    defaultSort: "nextDue",
    defaultDir: "asc",
    initialDirs: INITIAL_DIRS,
  })

  const showSource = !!equipment
  const equipmentNames = equipment ? Object.fromEntries(equipment.map((e) => [e.id, e.name])) : undefined
  const roomNames: Record<string, string> = Object.fromEntries(roomOptions.map((r) => [r.id, r.name]))

  const handleAttachmentDeleted = useCallback((scheduleId: string, attachmentId: string) => {
    setSchedules((prev) =>
      prev.map((s) =>
        s.id === scheduleId
          ? { ...s, attachments: s.attachments.filter((a) => a.id !== attachmentId) }
          : s
      )
    )
  }, [])

  async function handleDelete(s: MaintenanceScheduleWithAttachments) {
    if (!confirm(`Delete "${s.title}"?`)) return
    await deleteMaintenanceSchedule(s.id, s.assetType, s.assetId)
    toast.success("Schedule deleted.")
  }

  async function handleResume(s: MaintenanceScheduleWithAttachments) {
    const result = await setMaintenanceScheduleActive(s.id, true)
    if (!result || result.error) { toast.error("Something went wrong."); return }
    toast.success(`"${s.title}" resumed.`)
    router.refresh()
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{schedules.length} schedule{schedules.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true) }}>Add Schedule</Button>
      </div>

      {schedules.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No maintenance schedules yet.
          {assetType !== "PERSON" && (
            <>
              {" "}
              <Link href={remindersHref(assetType, assetId)} className="font-medium text-foreground underline-offset-4 hover:underline">
                Add default reminders
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead column="title" label="Title" sortState={table.sortState} onToggle={table.toggleSort} />
                <TableHead>Notes</TableHead>
                {showSource && <TableHead>Source</TableHead>}
                <SortableTableHead column="status" label="Status" sortState={table.sortState} onToggle={table.toggleSort} />
                <SortableTableHead column="nextDue" label="Next Due" sortState={table.sortState} onToggle={table.toggleSort} />
                <TableHead>Repeats</TableHead>
                <SortableTableHead column="lastCompleted" label="Last Completed" sortState={table.sortState} onToggle={table.toggleSort} />
                <TableHead>Files</TableHead>
                <TableHead className={`text-right ${stickyActions}`}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((s) => {
                const status = getStatus(s, currentMileage, meterUnit, fmt)
                const StatusIcon = status?.icon
                const expanded = expandedId === s.id
                return (
                  <Fragment key={s.id}>
                  <TableRow
                    className={`cursor-pointer ${s.isActive ? "" : "text-muted-foreground"}`}
                    onClick={() => { setEditing(s); setFormOpen(true) }}
                  >
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{s.title}</span>
                        {s.roomId && roomNames[s.roomId] && <Badge variant="outline" className="text-xs">{roomNames[s.roomId]}</Badge>}
                      </div>
                      {s.estimatedCost != null && <div className="text-xs text-muted-foreground">Est. {fmt.money(s.estimatedCost)}</div>}
                      <ManualLink manual={resolveManual(s, manualOptions ?? [])} className="mt-0.5" />
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      {s.description ? (
                        <Tooltip>
                          <TooltipTrigger className="block w-full truncate border-0 bg-transparent p-0 text-left text-muted-foreground">
                            {s.description}
                          </TooltipTrigger>
                          <TooltipContent align="start" className="whitespace-pre-wrap">{s.description}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {showSource && (
                      <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {s.assetType === "EQUIPMENT" ? (
                          <Link href={`/assets/equipment/${s.assetId}`} className="text-sm hover:underline">
                            {equipmentNames?.[s.assetId] ?? "Equipment"}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">Property</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {status && (
                        <Badge variant={status.variant} className="gap-1">
                          {StatusIcon && <StatusIcon className="h-3 w-3" />}
                          {status.label}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {s.nextDueDate && <div>{fmt.date(s.nextDueDate)}</div>}
                      {s.nextDueMileage != null && <div>{s.nextDueMileage.toLocaleString()} {fmt.meterShort(meterUnit)}</div>}
                      {!s.nextDueDate && s.nextDueMileage == null && (isDoneOnce(s) ? "Done" : "—")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {repeatsLabel(s, fmt.meterShort(meterUnit))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {s.lastCompletedDate ? fmt.date(s.lastCompletedDate) : "—"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <AttachmentCount attachments={s.attachments} onClick={() => setExpandedId(expanded ? null : s.id)} />
                    </TableCell>
                    <TableCell className={`text-right ${stickyActions}`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" className="h-7 text-xs px-2"
                          onClick={() => setCompleting(s)}>
                          Complete
                        </Button>
                        {s.isActive ? (
                          <SnoozeMenu schedule={s} />
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => handleResume(s)}>
                            <Play className="h-3.5 w-3.5" /> Resume
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit "${s.title}"`}
                          onClick={() => { setEditing(s); setFormOpen(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete "${s.title}"`}
                          onClick={() => handleDelete(s)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={expanded ? "Hide details" : "Show details"} aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : s.id)}>
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8 + (showSource ? 1 : 0)} className="bg-muted/30 whitespace-normal">
                        <AttachmentList recordId={s.id} recordType="MAINTENANCE" attachments={s.attachments} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>

          <PaginationBar
            page={table.page}
            pageCount={table.pageCount}
            total={table.total}
            per={table.per}
            onPage={table.setPage}
            onPer={table.setPer}
            label="schedules"
          />
        </div>
      )}

      <MaintenanceFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        assetId={assetId}
        assetType={assetType}
        schedule={editing}
        attachments={editing?.attachments ?? []}
        onAttachmentDeleted={handleAttachmentDeleted}
        equipmentOptions={equipment}
        propertyName={propertyName}
        roomOptions={roomOptions}
        defaultRoomId={defaultRoomId}
        meterUnit={meterUnit}
        manualOptions={manualOptions}
      />

      {completing && (
        <CompleteDialog
          schedule={completing}
          currentMileage={currentMileage}
          meterUnit={meterUnit}
          manual={resolveManual(completing, manualOptions ?? [])}
          onClose={() => setCompleting(null)}
        />
      )}
    </>
  )
}
