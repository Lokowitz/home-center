"use client"

import { Fragment, useCallback, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronDown, Pencil, Trash2 } from "lucide-react"
import { deleteServiceRecord } from "@/lib/actions/service-records"
import { ServiceRecordFormDialog } from "./service-record-form-dialog"
import { AttachmentList } from "@/components/attachments/attachment-list"
import { AttachmentCount } from "@/components/attachments/attachment-count"
import { SortableTableHead } from "@/components/ui/sortable-table-head"
import { PaginationBar } from "@/components/ui/pagination-bar"
import { useClientTable, type Accessor } from "@/lib/use-client-table"
import type { SortDir } from "@/lib/table-params"
import { meterUnitShort, meterUnitNoun } from "@/lib/maintenance-due"
import type { Attachment, ServiceRecord, MeterUnit, AssetType } from "@/app/generated/prisma/client"

type RecordWithAttachments = ServiceRecord & { attachments: Attachment[] }

// Module scope on purpose — a new object each render would re-sort every render.
const ACCESSORS: Record<string, Accessor<RecordWithAttachments>> = {
  date: (r) => new Date(r.date).getTime(),
  title: (r) => r.title,
  cost: (r) => r.cost,
  mileage: (r) => r.mileageAtService,
}

const INITIAL_DIRS: Record<string, SortDir> = { date: "desc", cost: "desc", mileage: "desc" }

interface Props {
  records: RecordWithAttachments[]
  assetId: string
  assetType: AssetType
  /** Property's equipment, for the Source column and the "For" picker when adding/editing. */
  equipment?: { id: string; name: string }[]
  propertyName?: string
  /** Vehicle's odometer unit, for the Mileage column header/suffix. Defaults to miles. */
  meterUnit?: MeterUnit
  /** People only: the provider directory and this person's conditions. */
  providerOptions?: { id: string; name: string }[]
  conditionOptions?: { id: string; name: string }[]
  /** Active reminders a new record can mark complete. */
  reminders?: { id: string; title: string; assetType: AssetType; assetId: string }[]
  openId?: string
}

export function ServiceRecordList({ records: initialRecords, assetId, assetType, equipment, propertyName, meterUnit = "MILES", providerOptions, conditionOptions, reminders, openId }: Props) {
  const isPerson = assetType === "PERSON"
  const equipmentNames = equipment ? Object.fromEntries(equipment.map((e) => [e.id, e.name])) : undefined
  const [records, setRecords] = useState(initialRecords)
  const [prevInitialRecords, setPrevInitialRecords] = useState(initialRecords)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (initialRecords !== prevInitialRecords) {
    setPrevInitialRecords(initialRecords)
    setRecords(initialRecords)
  }

  const [prevOpenId, setPrevOpenId] = useState<string | undefined>(undefined)
  if (openId !== prevOpenId) {
    setPrevOpenId(openId)
    if (openId && initialRecords.some((r) => r.id === openId)) { setEditingId(openId); setDialogOpen(true) }
  }

  const table = useClientTable({
    rows: records,
    accessors: ACCESSORS,
    defaultSort: "date",
    defaultDir: "desc",
    initialDirs: INITIAL_DIRS,
  })

  const editing = editingId ? records.find((r) => r.id === editingId) ?? null : null
  const showSource = !!equipmentNames
  const columnCount = 6 + (assetType === "VEHICLE" ? 1 : 0) + (showSource ? 1 : 0)

  const handleAttachmentDeleted = useCallback((recordId: string, attachmentId: string) => {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === recordId
          ? { ...r, attachments: r.attachments.filter((a) => a.id !== attachmentId) }
          : r
      )
    )
  }, [])

  async function handleDelete(record: ServiceRecord) {
    if (!confirm(`Delete "${record.title}"?`)) return
    await deleteServiceRecord(record.id, record.assetType, record.assetId)
    toast.success("Record deleted.")
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">{records.length} {isPerson ? "visit" : "record"}{records.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={() => { setEditingId(null); setDialogOpen(true) }}>{isPerson ? "Add Visit" : "Add Service Record"}</Button>
      </div>

      {records.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {isPerson ? "No visits yet." : "No service records yet."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead column="date" label="Date" sortState={table.sortState} onToggle={table.toggleSort} />
                <SortableTableHead column="title" label="Title" sortState={table.sortState} onToggle={table.toggleSort} />
                <TableHead>Notes</TableHead>
                {showSource && <TableHead>Source</TableHead>}
                <SortableTableHead column="cost" label="Cost" sortState={table.sortState} onToggle={table.toggleSort} />
                {assetType === "VEHICLE" && (
                  <SortableTableHead column="mileage" label={meterUnitNoun(meterUnit)} sortState={table.sortState} onToggle={table.toggleSort} />
                )}
                <TableHead>Files</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((record) => {
                const expanded = expandedId === record.id
                const isForeign = showSource && record.assetType !== assetType
                return (
                  <Fragment key={record.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => { setEditingId(record.id); setDialogOpen(true) }}
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(record.date).toLocaleDateString(undefined, { timeZone: "UTC" })}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{record.title}</div>
                        {record.vendor && <div className="text-xs text-muted-foreground">{record.vendor}</div>}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {record.description ? (
                          <Tooltip>
                            <TooltipTrigger className="block w-full truncate border-0 bg-transparent p-0 text-left text-muted-foreground">
                              {record.description}
                            </TooltipTrigger>
                            <TooltipContent align="start" className="whitespace-pre-wrap">{record.description}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {showSource && (
                        <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {isForeign ? (
                            <Link
                              href={`/assets/equipment/${record.assetId}`}
                              className="text-sm hover:underline"
                            >
                              {equipmentNames?.[record.assetId] ?? "Equipment"}
                            </Link>
                          ) : (
                            <span className="text-sm text-muted-foreground">Property</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap">
                        {record.cost != null ? `${record.cost < 0 ? "-$" : "$"}${Math.abs(record.cost).toLocaleString()}` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      {assetType === "VEHICLE" && (
                        <TableCell className="whitespace-nowrap">
                          {record.mileageAtService != null ? `${record.mileageAtService.toLocaleString()} ${meterUnitShort(meterUnit)}` : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <AttachmentCount
                          attachments={record.attachments}
                          onClick={() => setExpandedId(expanded ? null : record.id)}
                        />
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit "${record.title}"`}
                            onClick={() => { setEditingId(record.id); setDialogOpen(true) }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Delete "${record.title}"`}
                            onClick={() => handleDelete(record)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={expanded ? "Hide attachments" : "Show attachments"} aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : record.id)}>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={columnCount} className="bg-muted/30 whitespace-normal">
                          <AttachmentList
                            recordId={record.id}
                            recordType="SERVICE"
                            attachments={record.attachments}
                          />
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
            label="records"
          />
        </div>
      )}

      <ServiceRecordFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        assetId={assetId}
        assetType={assetType}
        record={editing}
        attachments={editing?.attachments ?? []}
        onAttachmentDeleted={handleAttachmentDeleted}
        equipmentOptions={equipment}
        propertyName={propertyName}
        meterUnit={meterUnit}
        providerOptions={providerOptions}
        conditionOptions={conditionOptions}
        reminderOptions={reminders}
      />
    </>
  )
}
