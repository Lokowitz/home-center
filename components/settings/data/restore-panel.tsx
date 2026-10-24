"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { Upload, RotateCcw, TriangleAlert, X } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { dismissRestoreNotice, restoreCancel, restoreCancelStaged, restoreConfirm, restoreDryRun, restoreRestart, restoreUndo } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import type { DryRun, RestoreResult } from "@/lib/backup/restore"
import { useFormat } from "@/components/regional-provider"

export type RestoreSource = { upload: string } | { file: string }

const LABELS: Record<string, string> = {
  Property: "Properties", Vehicle: "Vehicles", Equipment: "Equipment", Person: "People", ServiceRecord: "Service records",
  Warranty: "Warranties", MaintenanceSchedule: "Reminders", Attachment: "Files", User: "Accounts", InsurancePolicy: "Insurance policies",
  Medication: "Medications", HealthCondition: "Conditions", Observation: "Observations", Allergy: "Allergies", Immunization: "Immunizations",
  Provider: "Providers", InboxItem: "Intake items",
}
const SECRETS: Record<string, string> = {
  carried: "The mail password and AI key come with this backup.",
  "same-secret": "The mail password and AI key will work (same AUTH_SECRET).",
  "re-enter": "You'll need to re-enter the mail password and AI key afterwards.",
  none: "",
}
const MANUAL_RESTART = "Restart HomeCenter yourself to finish the restore: stop it and start it again, or restart the container."

export function RestorePanel({ data, source, setSource, onChanged }: {
  data: BackupOverview
  source: RestoreSource | null
  setSource: (s: RestoreSource | null) => void
  onChanged: () => Promise<void>
}) {
  const fmt = useFormat()
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const r = data.restore

  function upload(file: File) {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/backup/upload")
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      setProgress(null)
      if (input.current) input.current.value = ""
      if (xhr.status !== 200) {
        const msg = (() => { try { return (JSON.parse(xhr.responseText) as { error?: string }).error } catch { return undefined } })()
        return void toast.error(msg ?? "The upload didn't finish.")
      }
      setSource({ upload: (JSON.parse(xhr.responseText) as { id: string }).id })
    }
    xhr.onerror = () => {
      setProgress(null)
      toast.error("The upload didn't finish.")
    }
    setProgress(0)
    xhr.send(file)
  }

  async function cancelStaged() {
    try {
      const res = await restoreCancelStaged()
      if ("error" in res) return void toast.error(res.error, { duration: 15000 })
      toast.success(res.keptIn ? `Cancelled. The staged data was kept in ${res.keptIn}.` : "Cancelled. Nothing was changed.", res.keptIn ? { duration: Infinity } : undefined)
    } catch {
      toast.error("Couldn't cancel the restore. Try again.")
    }
    await onChanged()
  }

  async function dismiss() {
    try {
      const res = await dismissRestoreNotice()
      if ("error" in res) toast.error(res.error)
    } catch {
      toast.error("Couldn't dismiss the notice. Try again.")
    }
    await onChanged()
  }

  async function restart() {
    const { restarting, reason } = await restoreRestart()
    if (reason === "busy") return void toast.error("A backup or export is running. Try again when it has finished.")
    if (reason === "nothing-staged") return void toast.error("There's no restore waiting, so there's nothing to restart for.")
    if (!restarting) return void toast.info(MANUAL_RESTART, { duration: Infinity })
    await waitForRestart()
  }

  return (
    <Card className="py-5" id="restore">
      <CardHeader className="px-5">
        <CardTitle>Restore</CardTitle>
        <CardDescription>Replaces everything in HomeCenter with a backup. You&apos;ll see what changes before anything happens.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        {r?.pending && (
          <div className="space-y-2 rounded-md border p-3 text-sm" role="status">
            <p className="font-medium">A restore is ready and waiting for a restart.</p>
            <p className="text-muted-foreground">{MANUAL_RESTART} If HomeCenter restarts by itself, use the button.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={() => start(restart)}>Restart now</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => start(cancelStaged)}>Cancel staged restore</Button>
            </div>
          </div>
        )}
        {r?.result && !r.pending && !r.result.seenAt && <ResultNotice result={r.result} onDismiss={pending ? undefined : () => start(dismiss)} />}
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" className="hidden" accept=".hcbackup,.age,.zip" aria-label="Backup file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="outline" disabled={progress !== null || r?.pending} onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {progress !== null ? `Uploading… ${progress}%` : "Restore from a file"}
          </Button>
          {r?.undoAvailableUntil && !r.pending && (
            <Button variant="ghost" disabled={pending} onClick={() => start(async () => {
              if (!window.confirm("Go back to how HomeCenter was just before the last restore?")) return
              const res = await restoreUndo()
              if ("error" in res) return void toast.error(res.error, { duration: 15000 })
              await onChanged()
              await restart()
            })}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />Undo last restore
            </Button>
          )}
        </div>
        {r?.undoAvailableUntil && !r.pending && <p className="text-xs text-muted-foreground">You can undo the last restore until {fmt.dateTime(r.undoAvailableUntil)}.</p>}
        <p className="text-xs text-muted-foreground">Or use Restore on a backup in the list above.</p>
      </CardContent>
      {source && (
        <RestoreDialog
          source={source}
          onClose={() => { void restoreCancel(); setSource(null) }}
          onStaged={async () => { setSource(null); await onChanged() }}
          restart={restart}
        />
      )}
    </Card>
  )
}

function ResultNotice({ result, onDismiss }: { result: RestoreResult; onDismiss?: () => void }) {
  const fmt = useFormat()
  const close = (
    <button type="button" className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50" aria-label="Dismiss this notice" disabled={!onDismiss} onClick={onDismiss}>
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  )
  if (result.status === "ok") {
    return (
      <div className="flex items-start gap-2 text-sm">
        <p>{result.source === "undo" ? "Undid the restore" : `Restored from the backup of ${result.backupCreatedAt ? fmt.dateTime(result.backupCreatedAt) : "an earlier state"}`} on {fmt.dateTime(result.appliedAt)}.</p>
        {close}
      </div>
    )
  }
  if (result.rolledBack) {
    return (
      <div className="flex items-start gap-2 text-sm">
        <p className="text-destructive">The last restore didn&apos;t finish ({fmt.dateTime(result.appliedAt)}): {result.error} Nothing was changed.</p>
        {close}
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-md border border-destructive p-3 text-sm" role="alert">
      <div className="flex items-start gap-2">
        <p className="flex items-center gap-2 font-medium text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />The last restore failed part-way ({fmt.dateTime(result.appliedAt)}).</p>
        {/* Only once someone has dealt with the displaced data (npm run restore -- --ack). */}
        {result.acknowledgedAt && close}
      </div>
      <p>{result.error}</p>
      <p>Your earlier data was moved out of the way, so what HomeCenter shows may be incomplete. It is kept in {result.recoveryDirs.length === 1 ? "this folder" : "these folders"}:</p>
      {result.recoveryDirs.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {result.recoveryDirs.map((d) => <li key={d} className="break-all font-mono text-xs">{d}</li>)}
        </ul>
      )}
      <p>Move the data back into place, or ask whoever runs this server to.</p>
    </div>
  )
}

/** Waits for the old process to go and the new one to answer, then reloads at the login page. */
async function waitForRestart() {
  toast.loading("Restarting HomeCenter…", { duration: Infinity })
  await new Promise((r) => setTimeout(r, 2000))
  for (;;) {
    try {
      if ((await fetch("/api/health", { cache: "no-store" })).ok) break
    } catch {
      // still restarting
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  window.location.href = "/login"
}

function RestoreDialog({ source, onClose, onStaged, restart }: {
  source: RestoreSource
  onClose: () => void
  onStaged: () => Promise<void>
  restart: () => Promise<void>
}) {
  const fmt = useFormat()
  const [report, setReport] = useState<DryRun | null>(null)
  const [key, setKey] = useState("")
  const [password, setPassword] = useState("")
  const [word, setWord] = useState("")
  const [pending, start] = useTransition()

  function check() {
    start(async () => {
      const r = await restoreDryRun({ source, key: key || undefined, password: password || undefined })
      setReport(r)
      if (r.ok) { setKey(""); setPassword("") } // not kept once the backup is open
    })
  }
  // First check as soon as the dialog opens; Unlock re-runs it with the key or password.
  const first = useRef(false)
  useEffect(() => {
    if (first.current) return
    first.current = true
    check()
  })

  const needs = report && !report.ok ? report.needs : undefined
  return (
    <Dialog open onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Restore a backup</DialogTitle>
          <DialogDescription>Checking the backup before anything changes.</DialogDescription>
        </DialogHeader>

        {pending && !report?.ok && <p className="text-sm text-muted-foreground">Checking…</p>}

        {report && !report.ok && (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{report.error}</p>
            {needs === "key" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-key" help="restore.key">Recovery key (paste it, or choose the kit file)</Label>
                <Textarea id="rs-key" rows={3} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AGE-SECRET-KEY-1…" />
                <Input type="file" accept=".txt" aria-label="Recovery kit file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setKey(await f.text()) }} />
              </div>
            )}
            {needs === "password" && (
              <div className="space-y-1.5">
                <Label htmlFor="rs-pw" help="restore.password">Password</Label>
                <Input id="rs-pw" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {report?.ok && (
          <div className="space-y-3 text-sm">
            <p>Backup from <strong>{fmt.dateTime(report.manifest.createdAt)}</strong> (HomeCenter {report.manifest.appVersion}).</p>
            <table className="w-full text-xs">
              <thead><tr className="text-muted-foreground"><th className="text-left font-normal">What</th><th className="text-right font-normal">Now</th><th className="text-right font-normal">After restore</th></tr></thead>
              <tbody>
                {Object.keys(LABELS).filter((k) => report.backupCounts[k] || report.currentCounts[k]).map((k) => (
                  <tr key={k}><td>{LABELS[k]}</td><td className="text-right tabular-nums">{report.currentCounts[k] ?? 0}</td><td className="text-right tabular-nums">{report.backupCounts[k] ?? 0}</td></tr>
                ))}
              </tbody>
            </table>
            {SECRETS[report.secrets] && <p className="text-xs">{SECRETS[report.secrets]}</p>}
            {report.warnings.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{report.warnings.length} file(s) were already missing when this backup was made.</p>}
            <p className="rounded-md border border-destructive/40 p-2 text-xs">
              Everything now in HomeCenter is replaced. Everyone is signed out, and sign-ins become the accounts in this backup.
              You can undo this for 7 days.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="rs-word" help="restore.confirm">Type RESTORE to continue</Label>
              <Input id="rs-word" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
          {needs && <Button disabled={pending || (needs === "key" ? !key : !password)} onClick={check}>Unlock</Button>}
          {report?.ok && (
            <Button variant="destructive" disabled={pending || word.trim() !== "RESTORE"} onClick={() => start(async () => {
              const r = await restoreConfirm({ word })
              if ("error" in r) return void toast.error(r.error, { duration: 15000 })
              await onStaged()
              await restart()
            })}>
              Restore and restart
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
