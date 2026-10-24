"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { saveBackupSchedule } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { WEEKDAYS } from "./format"

export function BackupSchedule({ data, onSaved }: { data: BackupOverview; onSaved: () => Promise<void> }) {
  const s = data.settings
  const [schedule, setSchedule] = useState(s.schedule)
  const [time, setTime] = useState(s.time)
  const [weekday, setWeekday] = useState(String(s.weekday))
  const [folder, setFolder] = useState(s.folderIsDefault ? "" : s.folder)
  const [keep, setKeep] = useState(String(s.keep))
  const [pending, start] = useTransition()

  function save(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await saveBackupSchedule({ schedule, time, weekday, folder, keep })
      if ("error" in r) return void toast.error(r.error)
      toast.success("Backup schedule saved.")
      if (r.warning) toast.warning(r.warning)
      await onSaved()
    })
  }

  const select = "h-9 rounded-md border bg-background px-2 text-sm"
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Schedule</CardTitle>
        <CardDescription>Backups run in the background at this time, server time. Older ones are removed after the newest {s.keep}.</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bk-schedule" help="backup.schedule">How often</Label>
            <select id="bk-schedule" className={select} value={schedule} onChange={(e) => setSchedule(e.target.value as typeof schedule)}>
              <option value="OFF">Off</option>
              <option value="DAILY">Every day</option>
              <option value="WEEKLY">Every week</option>
            </select>
          </div>
          <div className="flex gap-3">
            {schedule === "WEEKLY" && (
              <div className="space-y-1.5">
                <Label htmlFor="bk-day" help="backup.day">Day</Label>
                <select id="bk-day" className={select} value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bk-time" help="backup.time">Time</Label>
              <Input id="bk-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={schedule === "OFF"} />
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bk-folder" help="backup.folder">Folder</Label>
            <Input id="bk-folder" placeholder={`${s.folderIsDefault ? s.folder : "/data/backups"} (default)`} value={folder} onChange={(e) => setFolder(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              A path inside the container. For a real backup, mount a different disk or NAS share (for example <code>/backups</code>) in docker-compose.
              {data.folderStatus.sameDevice && data.folderStatus.exists ? " The current folder is on the same disk as your data." : ""}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-keep" help="backup.keep">Keep the newest</Label>
            <Input id="bk-keep" type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(e.target.value)} />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save schedule"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
