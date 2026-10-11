"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { backUpNow, dismissBackupHint } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { formatBytes, formatWhen, PROTECTION_LABEL } from "./format"

const TONE = {
  ok: { icon: CheckCircle2, text: "Backups are up to date", cls: "text-emerald-600 dark:text-emerald-400" },
  stale: { icon: AlertTriangle, text: "Backups need attention", cls: "text-amber-600 dark:text-amber-400" },
  failed: { icon: XCircle, text: "The last backup failed", cls: "text-destructive" },
  none: { icon: Info, text: "No backups yet", cls: "text-muted-foreground" },
} as const

export function BackupStatus({ data, onStarted }: { data: BackupOverview; onStarted: () => Promise<void> }) {
  const [pending, start] = useTransition()
  const tone = TONE[data.tone]
  const newest = data.backups[0]
  const run = data.running

  function now() {
    start(async () => {
      const r = await backUpNow()
      if ("error" in r) toast.error(r.error)
      else toast.success("Backup started. You can leave this page.")
      await onStarted()
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className={cn("flex items-center gap-2", tone.cls)}>
          <tone.icon className="h-5 w-5" aria-hidden="true" />
          {tone.text}
        </CardTitle>
        <CardDescription>
          {newest
            ? `Last backup ${formatWhen(newest.createdAt)} · ${formatBytes(newest.size)} · ${PROTECTION_LABEL[newest.protection]}`
            : "Make your first backup now, or turn on a schedule below."}
          {data.nextRunAt && data.settings.schedule !== "OFF" ? ` · Next ${formatWhen(data.nextRunAt)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5">
        {data.lastRun?.status === "FAILED" || data.lastRun?.status === "INTERRUPTED" ? (
          <p className="text-sm text-destructive">{data.lastRun.error}</p>
        ) : null}
        {data.lastRun?.status === "WARN" && (
          <details className="text-sm text-amber-700 dark:text-amber-400">
            <summary>{data.lastRun.warnings.length} file(s) were missing from the last backup</summary>
            <ul className="mt-1 list-disc pl-5 text-xs">{data.lastRun.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
        {data.settings.protection === "NONE" && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Backups are readable by anyone who gets the file.{" "}
            {data.healthEnabled ? "They include health records and documents." : "They include your records and documents."}{" "}
            You can protect them under Protection.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={now} disabled={pending || !!run}>
            {run ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {run ? (run.total ? `Backing up… ${run.done} of ${run.total} files` : "Backing up…") : "Back up now"}
          </Button>
          <span className="text-xs text-muted-foreground">Saved to {data.settings.folder}</span>
        </div>
        {!newest && !data.settings.hintDismissed && data.settings.schedule === "OFF" && (
          <p className="text-xs text-muted-foreground">
            Tip: a daily backup to a different disk (a NAS share or USB drive) protects against a failed drive.{" "}
            <button type="button" className="underline" onClick={() => void dismissBackupHint().then(onStarted)}>Dismiss</button>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
