"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { FileDown, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { exportStatus, startExport } from "@/lib/actions/backup"
import { passwordProblem } from "@/lib/backup/protect-shared"
import type { AssetKind } from "@/lib/backup/format"
import type { BackupOverview } from "@/lib/backup/overview-server"

const GROUPS: { type: AssetKind; label: string }[] = [
  { type: "PROPERTY", label: "Properties" },
  { type: "VEHICLE", label: "Vehicles" },
  { type: "EQUIPMENT", label: "Equipment" },
  { type: "PERSON", label: "People" },
]

export function ExportPanel({ data }: { data: BackupOverview }) {
  const [scope, setScope] = useState("all")
  const [includeHealth, setIncludeHealth] = useState(false)
  const [protect, setProtect] = useState(false)
  const [pw, setPw] = useState("")
  const [again, setAgain] = useState("")
  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!runId) return
    const finish = () => {
      clearInterval(t)
      setRunId(null)
      setProgress(null)
    }
    const t = setInterval(async () => {
      try {
        const s = await exportStatus(runId)
        setProgress({ done: s.done, total: s.total })
        if (s.status === "OK" || s.status === "WARN") {
          finish()
          setPw("")
          setAgain("")
          window.location.href = `/api/backup/export/${runId}`
          toast.success("Export ready. It downloads once and isn't kept on the server.")
        } else if (s.status !== "RUNNING") {
          finish()
          toast.error(s.error ?? "The export didn't finish.")
        }
      } catch {
        finish()
        toast.error("Lost track of the export. Try again.")
      }
    }, 1000)
    return () => clearInterval(t)
  }, [runId])

  const pwProblem = protect && pw ? passwordProblem(pw) : null
  const blocked = protect && (!pw || !!pwProblem || pw !== again)
  const busy = pending || !!runId || !!data.running

  function go() {
    start(async () => {
      const [type, id] = scope.split(":")
      const r = await startExport({
        scope: scope === "all" ? "all" : { assetType: type as AssetKind, assetId: id },
        includeHealth, password: protect ? pw : "",
      })
      if ("error" in r) return void toast.error(r.error)
      setRunId(r.runId)
    })
  }

  const select = "h-9 w-full rounded-md border bg-background px-2 text-sm"
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Export</CardTitle>
        <CardDescription>
          A zip you can open on any computer: an offline page to browse everything, spreadsheets (CSV), and every file in readable folders. Exports can&apos;t be restored; use a backup for that.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ex-scope">What</Label>
          <select id="ex-scope" className={select} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Everything</option>
            {GROUPS.map((g) => {
              const items = data.assets.filter((a) => a.type === g.type)
              return items.length === 0 ? null : (
                <optgroup key={g.type} label={g.label}>
                  {items.map((a) => <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>{a.name}</option>)}
                </optgroup>
              )
            })}
          </select>
        </div>
        {scope === "all" && data.healthEnabled && (
          <label className="flex items-center gap-2 self-end text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={includeHealth} onChange={(e) => setIncludeHealth(e.target.checked)} />
            Include health records
          </label>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
          Protect with a password (send the password separately from the file)
        </label>
        {protect && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ex-pw">Password</Label>
              <Input id="ex-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              {pwProblem && <p className="text-xs text-destructive">{pwProblem}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-pw2">Same password again</Label>
              <Input id="ex-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
              {again && pw !== again && <p className="text-xs text-destructive">The passwords don&apos;t match.</p>}
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <Button onClick={go} disabled={busy || blocked}>
            {runId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
            {runId ? (progress?.total ? `Exporting… ${progress.done} of ${progress.total} files` : "Exporting…") : "Create export"}
          </Button>
          {data.running && !runId && <p className="mt-2 text-xs text-muted-foreground">Wait for the running backup or export to finish.</p>}
        </div>
      </CardContent>
    </Card>
  )
}
