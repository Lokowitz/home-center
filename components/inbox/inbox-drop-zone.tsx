"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Upload } from "lucide-react"
import { toast } from "sonner"
import type { AssetType } from "@/app/generated/prisma/client"
import { Button } from "@/components/ui/button"
import { useDropZone } from "@/components/drop/drop-provider"
import { addFileToInbox } from "./add-to-inbox"
import { uploadAccept } from "@/lib/inbox-form"
import { intakeAddedMessage, intakeLabel } from "@/lib/drop-target"
import { cn } from "@/lib/utils"

const ACCEPT = uploadAccept()

type Props = {
  /** "full": the Intake page's drop area. "compact": a small target that fits in a card. */
  variant?: "full" | "compact"
  /** Files added here start with this asset chosen (the reader keeps it). `name` is for the drag label. */
  asset?: { assetType: AssetType; assetId: string; name?: string }
  className?: string
}

export function InboxDropZone({ variant = "full", asset, className }: Props) {
  const router = useRouter()
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(0)
  const target = asset ? { assetType: asset.assetType, assetId: asset.assetId } : undefined
  const compact = variant === "compact"

  async function addFiles(files: File[]) {
    if (!files.length) return
    setBusy((n) => n + files.length)
    // Each file is its own item; uploads run together.
    const landed = await Promise.all(
      files.map(async (f) => {
        // The full zone sits on the Intake page, where the new card is the confirmation.
        const ok = await addFileToInbox(f, { successToast: !compact, asset: target })
        setBusy((n) => n - 1)
        return ok
      })
    )
    const count = landed.filter(Boolean).length
    if (compact && count) toast.success(intakeAddedMessage(count), { action: { label: "View", onClick: () => router.push("/intake") } })
    router.refresh()
  }

  // Drops are routed here by the app-wide DropProvider (which checks the types first).
  const { setElement: setDropElement, over: dropOver } = useDropZone({
    label: intakeLabel(asset ? { assetType: asset.assetType, assetId: asset.assetId, name: asset.name ?? "" } : null),
    onFiles: (files) => void addFiles(files),
  })

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    void addFiles(Array.from(e.target.files ?? []))
    e.target.value = ""
  }

  const inputs = (
    <>
      <input ref={pickRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onInput} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onInput} />
    </>
  )
  const uploading = busy > 0 && (
    <p className="text-xs text-muted-foreground" aria-live="polite">Uploading {busy} file{busy === 1 ? "" : "s"}…</p>
  )

  if (compact) {
    return (
      <div
        ref={setDropElement}
        className={cn(
          "flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm transition-colors",
          dropOver ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border",
          className
        )}
      >
        {/* One row: a card around it already says what goes here. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => pickRef.current?.click()}>
            <Upload />
            Choose files
          </Button>
          <Button type="button" size="sm" variant="outline" className="md:hidden" onClick={() => cameraRef.current?.click()}>
            <Camera />
            Take photo
          </Button>
          <span className="hidden text-muted-foreground md:inline">or drop them here</span>
        </div>
        {uploading}
        {inputs}
      </div>
    )
  }

  return (
    <div
      ref={setDropElement}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        dropOver ? "border-primary bg-primary/5" : "border-border",
        className
      )}
    >
      <Upload className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
      <div>
        <p className="font-medium">
          <span className="hidden md:inline">Drop receipts and invoices here</span>
          <span className="md:hidden">Add receipts and invoices</span>
        </p>
        <p className="text-sm text-muted-foreground">PDFs, photos and documents. Each file becomes its own item.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => pickRef.current?.click()}>
          <Upload />
          Choose files
        </Button>
        <Button type="button" variant="outline" className="md:hidden" onClick={() => cameraRef.current?.click()}>
          <Camera />
          Take photo
        </Button>
      </div>
      {uploading}
      {inputs}
    </div>
  )
}
