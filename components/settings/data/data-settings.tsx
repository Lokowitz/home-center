"use client"

import { useCallback, useEffect, useState } from "react"
import { getBackupOverview } from "@/lib/actions/backup"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { BackupStatus } from "./backup-status"
import { BackupSchedule } from "./backup-schedule"
import { BackupProtection } from "./backup-protection"
import { BackupList } from "./backup-list"
import { ExportPanel } from "./export-panel"
import { RestorePanel, type RestoreSource } from "./restore-panel"

/** Settings → Data. Holds the overview and polls it while a job runs. */
export function DataSettings({ initial }: { initial: BackupOverview }) {
  const [data, setData] = useState(initial)
  const [restoreSource, setRestoreSource] = useState<RestoreSource | null>(null)
  const refresh = useCallback(async () => setData(await getBackupOverview()), [])

  useEffect(() => {
    if (!data.running) return
    const t = setInterval(() => void refresh(), 1000)
    return () => clearInterval(t)
  }, [data.running, refresh])

  return (
    <div className="space-y-6">
      <BackupStatus data={data} onStarted={refresh} />
      <BackupSchedule data={data} onSaved={refresh} />
      <BackupProtection data={data} onSaved={refresh} />
      <BackupList data={data} onChanged={refresh} onRestore={(b) => setRestoreSource({ file: b.file })} />
      <ExportPanel data={data} />
      <RestorePanel data={data} source={restoreSource} setSource={setRestoreSource} onChanged={refresh} />
    </div>
  )
}
