"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Camera, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { addFileToInbox } from "./add-to-inbox"
import { uploadAccept } from "@/lib/inbox-form"
import { cn } from "@/lib/utils"

const ACCEPT = uploadAccept()

export function InboxDropZone() {
  const router = useRouter()
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(0)

  async function addFiles(list: FileList | null) {
    const files = list ? Array.from(list) : []
    if (!files.length) return
    setBusy((n) => n + files.length)
    // Each file is its own item; uploads run together.
    await Promise.all(
      files.map(async (f) => {
        await addFileToInbox(f)
        setBusy((n) => n - 1)
      })
    )
    router.refresh()
  }

  function onInput(e: React.ChangeEvent<HTMLInputElement>) {
    void addFiles(e.target.files)
    e.target.value = ""
  }

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(e) => {
        // Ignore leaving into a child element.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void addFiles(e.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border"
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
      {busy > 0 && <p className="text-xs text-muted-foreground" aria-live="polite">Uploading {busy} file{busy === 1 ? "" : "s"}…</p>}
      <input ref={pickRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={onInput} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onInput} />
    </div>
  )
}
