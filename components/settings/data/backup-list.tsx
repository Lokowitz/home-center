"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { Download, ShieldCheck, Trash2, KeyRound, Lock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { removeBackup, verifyBackup } from "@/lib/actions/backup"
import type { BackupOverview, BackupRow } from "@/lib/backup/overview-server"
import { formatBytes, formatWhen, PROTECTION_LABEL } from "./format"

export function BackupList({ data, onChanged, onRestore }: { data: BackupOverview; onChanged: () => Promise<void>; onRestore?: (b: BackupRow) => void }) {
  const [pending, start] = useTransition()
  const act = (fn: () => Promise<void>) => start(fn)

  if (data.backups.length === 0) return null
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Backups</CardTitle>
        <CardDescription>In {data.settings.folder}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <ul className="divide-y">
          {data.backups.map((b) => (
            <li key={b.file} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{formatWhen(b.createdAt)}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {formatBytes(b.size)}
                  <span className="inline-flex items-center gap-1">
                    {b.protection === "key" ? <KeyRound className="h-3 w-3" aria-hidden="true" /> : b.protection === "password" ? <Lock className="h-3 w-3" aria-hidden="true" /> : null}
                    {PROTECTION_LABEL[b.protection]}
                    {b.keyFingerprint ? ` ${b.keyFingerprint}` : ""}
                  </span>
                  {b.warningCount > 0 && <span className="text-amber-600 dark:text-amber-400">{b.warningCount} missing file(s)</span>}
                </p>
              </div>
              <div className="flex gap-1">
                <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/api/backup/download?file=${encodeURIComponent(b.file)}`} aria-label={`Download ${b.file}`}>
                  <Download className="h-4 w-4" aria-hidden="true" />
                </a>
                <Button variant="ghost" size="sm" disabled={pending} aria-label="Check this backup"
                  onClick={() => act(async () => { const r = await verifyBackup(b.file); if ("error" in r) toast.error(r.error); else toast.success(r.message) })}>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                </Button>
                {onRestore && <Button variant="outline" size="sm" onClick={() => onRestore(b)}>Restore</Button>}
                <Button variant="ghost" size="sm" disabled={pending} aria-label="Delete this backup"
                  onClick={() => act(async () => {
                    if (!window.confirm(`Delete the backup from ${formatWhen(b.createdAt)}? This can't be undone.`)) return
                    const r = await removeBackup(b.file)
                    if ("error" in r) toast.error(r.error)
                    await onChanged()
                  })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
