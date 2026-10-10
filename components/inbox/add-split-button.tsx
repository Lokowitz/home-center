"use client"

import { useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Camera, ChevronDown, Plus, ReceiptText } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { addFileToInbox } from "@/components/inbox/add-to-inbox"
import { uploadAccept } from "@/lib/inbox-form"
import { cn } from "@/lib/utils"
import type { AssetType } from "@/app/generated/prisma/client"

const ACCEPT = uploadAccept()

/**
 * "Add record ▾": the main part opens the manual form; the menu sends a
 * receipt to Intake instead, tagged with this page's asset (none on the
 * cross-asset Records page).
 */
export function AddSplitButton({
  label,
  onAdd,
  asset,
  fromFileLabel = "From a receipt or invoice…",
  menuLabel = "More ways to add a record",
}: {
  label: string
  onAdd: () => void
  asset?: { assetType: AssetType; assetId: string }
  fromFileLabel?: string
  menuLabel?: string
}) {
  const router = useRouter()
  const pickRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  async function addFiles(input: HTMLInputElement) {
    const files = input.files ? Array.from(input.files) : []
    input.value = ""
    if (!files.length) return
    const results = await Promise.all(files.map((f) => addFileToInbox(f, { successToast: false, asset })))
    if (results.some(Boolean)) {
      toast.success("Added to Intake — reading it now", { action: { label: "View", onClick: () => router.push("/intake") } })
      router.refresh()
    }
  }

  return (
    <div role="group" aria-label={label} className="inline-flex">
      <Button size="sm" className="rounded-r-none" onClick={onAdd}>
        <Plus />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={menuLabel}
          className={cn(buttonVariants({ size: "icon-sm" }), "rounded-l-none border-l border-l-primary-foreground/25")}
        >
          <ChevronDown />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-60">
          <DropdownMenuItem onClick={() => pickRef.current?.click()} className="items-start">
            <ReceiptText className="mt-0.5" />
            <span className="flex flex-col">
              <span>{fromFileLabel}</span>
              <span className="text-xs text-muted-foreground">or drag it onto any page</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => cameraRef.current?.click()} className="md:hidden">
            <Camera />
            Take photo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={pickRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void addFiles(e.currentTarget)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void addFiles(e.currentTarget)} />
    </div>
  )
}
