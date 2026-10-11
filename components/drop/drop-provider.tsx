"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Ban, Paperclip, Upload } from "lucide-react"
import type { AssetType } from "@/app/generated/prisma/client"
import { addFileToInbox } from "@/components/inbox/add-to-inbox"
import {
  dragCarriesFiles, intakeAddedMessage, rejectedFilesMessage, resolveDrop, splitDroppedFiles,
  type DropAsset, type DropDestination,
} from "@/lib/drop-target"
import { cn } from "@/lib/utils"

// Drop a file anywhere in the app. One window-level listener decides where it
// goes (lib/drop-target.ts): an open dialog's attachment list, a drop zone
// under the pointer, or Intake (with the page's asset on an asset page). The
// overlay names the destination before the file is let go.

type FilesHandler = (files: File[]) => void

type Entry = { kind: "dialog" | "zone"; label: string; order: number; el: Element | null; onFiles: FilesHandler }

type Registry = {
  register: (id: string, entry: Entry) => void
  update: (id: string, patch: Partial<Entry>) => void
  unregister: (id: string) => void
  nextOrder: () => number
  setPageAsset: (id: string, asset: DropAsset | null) => void
}

const RegistryContext = createContext<Registry | null>(null)
/** The zone currently under a file drag, so it can highlight itself. */
const OverContext = createContext<string | null>(null)

/** A modal is open (dialog or sheet). Popovers also use role="dialog" but aren't modal. */
const MODAL_SELECTOR = [
  '[role="dialog"]:not([data-slot="popover-content"]):not([data-closed])',
  '[role="alertdialog"]:not([data-closed])',
].join(", ")

/** With no dragover for this long the drag has ended somewhere we didn't hear about. */
const STALE_DRAG_MS = 1500

export function DropProvider({ healthEnabled, children }: { healthEnabled: boolean; children: React.ReactNode }) {
  const router = useRouter()
  const entries = useRef(new Map<string, Entry>())
  const pageAssets = useRef(new Map<string, DropAsset>())
  const order = useRef(0)
  const [destination, setDestination] = useState<DropDestination | null>(null)

  const registry = useMemo<Registry>(
    () => ({
      register: (id, entry) => void entries.current.set(id, entry),
      update: (id, patch) => {
        const e = entries.current.get(id)
        if (e) Object.assign(e, patch)
      },
      unregister: (id) => void entries.current.delete(id),
      nextOrder: () => ++order.current,
      setPageAsset: (id, asset) => {
        if (asset) pageAssets.current.set(id, asset)
        else pageAssets.current.delete(id)
      },
    }),
    []
  )

  const resolve = useCallback(
    (target: EventTarget | null): DropDestination => {
      const all = [...entries.current.entries()]
      const node = target instanceof Node ? target : null
      const zones = all.filter(([, e]) => e.kind === "zone" && e.el && node && e.el.contains(node))
      // The innermost zone: the one inside every other match.
      const zone = zones.find(([, z]) => zones.every(([, o]) => o === z || o.el!.contains(z.el!)))
      const pageAsset = [...pageAssets.current.values()].at(-1) ?? null
      // Portalled popups are appended in opening order, so the last open one is on top.
      const topModal = [...document.querySelectorAll(MODAL_SELECTOR)].at(-1) ?? null
      return resolveDrop({
        dialogTargets: all
          .filter(([, e]) => e.kind === "dialog")
          .map(([id, e]) => ({ id, label: e.label, order: e.order, isTop: e.el && e.el.isConnected ? e.el === topModal : undefined })),
        modalOpen: !!topModal,
        zone: zone ? { id: zone[0], label: zone[1].label } : null,
        pageAsset,
        healthEnabled,
      })
    },
    [healthEnabled]
  )

  const toIntake = useCallback(
    async (files: File[], asset: DropAsset | null) => {
      const target = asset ? { assetType: asset.assetType, assetId: asset.assetId } : undefined
      const landed = await Promise.all(files.map((f) => addFileToInbox(f, { successToast: false, asset: target })))
      const count = landed.filter(Boolean).length
      if (count) {
        toast.success(intakeAddedMessage(count), { action: { label: "View", onClick: () => router.push("/intake") } })
        // The Intake badge and the Intake page, if that's where this is.
        router.refresh()
      }
    },
    [router]
  )

  useEffect(() => {
    let depth = 0
    let stale: ReturnType<typeof setTimeout> | undefined
    let shown: DropDestination | null = null

    const show = (d: DropDestination | null) => {
      // Only re-render when what the overlay says changes (dragover fires constantly).
      if (shown?.kind === d?.kind && shown?.label === d?.label && targetOf(shown) === targetOf(d)) return
      shown = d
      setDestination(d)
    }
    const hide = () => {
      depth = 0
      clearTimeout(stale)
      show(null)
    }
    const keepAlive = () => {
      clearTimeout(stale)
      stale = setTimeout(hide, STALE_DRAG_MS)
    }

    const onEnter = (e: DragEvent) => {
      if (!dragCarriesFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      depth++
      keepAlive()
      show(resolve(e.target))
    }
    const onOver = (e: DragEvent) => {
      if (!dragCarriesFiles(e.dataTransfer?.types)) return
      // Without this the browser opens the file instead of letting us have it.
      e.preventDefault()
      const d = resolve(e.target)
      if (e.dataTransfer) e.dataTransfer.dropEffect = d.kind === "blocked" ? "none" : "copy"
      keepAlive()
      show(d)
    }
    const onLeave = (e: DragEvent) => {
      if (!dragCarriesFiles(e.dataTransfer?.types)) return
      depth = Math.max(0, depth - 1)
      // relatedTarget is null when the drag leaves the window.
      if (depth === 0 || e.relatedTarget === null) hide()
    }
    const onDrop = (e: DragEvent) => {
      if (!dragCarriesFiles(e.dataTransfer?.types)) return
      e.preventDefault()
      const d = resolve(e.target)
      const files = Array.from(e.dataTransfer?.files ?? [])
      hide()
      if (!files.length) return
      if (d.kind === "blocked") {
        toast.info(`${d.label}. Close it to add files to Intake.`)
        return
      }
      const { accepted, rejected } = splitDroppedFiles(files)
      if (rejected.length) toast.error(rejectedFilesMessage(rejected.map((f) => f.name)))
      if (!accepted.length) return
      if (d.kind === "intake") void toIntake(accepted, d.asset)
      else entries.current.get(d.targetId)?.onFiles(accepted)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide()
    }

    window.addEventListener("dragenter", onEnter)
    window.addEventListener("dragover", onOver)
    window.addEventListener("dragleave", onLeave)
    window.addEventListener("drop", onDrop)
    window.addEventListener("dragend", hide)
    window.addEventListener("keydown", onKey)
    window.addEventListener("blur", hide)
    return () => {
      clearTimeout(stale)
      window.removeEventListener("dragenter", onEnter)
      window.removeEventListener("dragover", onOver)
      window.removeEventListener("dragleave", onLeave)
      window.removeEventListener("drop", onDrop)
      window.removeEventListener("dragend", hide)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("blur", hide)
    }
  }, [resolve, toIntake])

  const over = destination?.kind === "zone" ? destination.targetId : null

  return (
    <RegistryContext.Provider value={registry}>
      <OverContext.Provider value={over}>
        {children}
        {destination && <DropOverlay destination={destination} />}
      </OverContext.Provider>
    </RegistryContext.Provider>
  )
}

function targetOf(d: DropDestination | null): string | null {
  return d && (d.kind === "dialog" || d.kind === "zone") ? d.targetId : null
}

/** Decoration only: the result is announced by the toast after the drop. */
function DropOverlay({ destination }: { destination: DropDestination }) {
  const blocked = destination.kind === "blocked"
  const zone = destination.kind === "zone"
  const Icon = blocked ? Ban : destination.kind === "intake" ? Upload : Paperclip
  return (
    <div
      aria-hidden="true"
      data-drop-overlay={destination.kind}
      className={cn(
        "pointer-events-none fixed inset-0 z-[100] flex justify-center p-6",
        // Over a zone the zone itself lights up, so the overlay steps back to a label at the bottom.
        zone ? "items-end" : "items-center",
        !zone && (blocked ? "bg-background/40" : "bg-primary/10 ring-4 ring-inset ring-primary/60")
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border bg-popover px-5 py-4 text-popover-foreground shadow-lg",
          blocked ? "border-border text-muted-foreground" : "border-primary"
        )}
      >
        <Icon className={cn("h-6 w-6 shrink-0", blocked ? "text-muted-foreground" : "text-primary")} strokeWidth={1.75} />
        <span className="text-base font-medium">{destination.label}</span>
      </div>
    </div>
  )
}

/**
 * For a dialog with an attachment list: while `enabled` (the dialog is open),
 * files dropped anywhere go to `onFiles` — already checked against the
 * accepted types. The most recently opened such dialog wins.
 */
export function useDropTarget({ label, onFiles, enabled = true }: { label: string; onFiles: FilesHandler; enabled?: boolean }) {
  useRegistration("dialog", label, onFiles, enabled, null)
}

/**
 * For an on-page drop zone: pass `setElement` as its element's ref. Files dropped on it
 * go to `onFiles`; `over` is true while a file drag is over it.
 */
export function useDropZone({ label, onFiles, enabled = true }: { label: string; onFiles: FilesHandler; enabled?: boolean }): {
  setElement: (el: Element | null) => void
  over: boolean
} {
  const [el, setEl] = useState<Element | null>(null)
  const id = useRegistration("zone", label, onFiles, enabled, el)
  const over = useContext(OverContext) === id
  return { setElement: setEl, over }
}

function useRegistration(kind: Entry["kind"], label: string, onFiles: FilesHandler, enabled: boolean, el: Element | null): string {
  const registry = useContext(RegistryContext)
  const id = useId()
  useEffect(() => {
    if (!registry || !enabled || (kind === "zone" && !el)) return
    registry.register(id, { kind, label, order: registry.nextOrder(), el, onFiles: () => {} })
    // A dialog doesn't pass its element: its popup is the topmost open modal
    // once it has rendered, so remember that one to tell it apart from a
    // dialog opened on top of it later.
    let frame = 0
    if (kind === "dialog") {
      frame = requestAnimationFrame(() => {
        const popup = [...document.querySelectorAll(MODAL_SELECTOR)].at(-1) ?? null
        registry.update(id, { el: popup })
      })
    }
    return () => {
      cancelAnimationFrame(frame)
      registry.unregister(id)
    }
    // onFiles is kept current below without re-registering (which would change the order).
  }, [registry, id, kind, label, enabled, el])
  useEffect(() => {
    registry?.update(id, { onFiles })
  })
  return id
}

/** On an asset's page: files dropped on the page go to Intake with this asset chosen. */
export function useDropPageContext({ asset }: { asset: DropAsset | null }) {
  const registry = useContext(RegistryContext)
  const id = useId()
  const assetType = asset?.assetType
  const assetId = asset?.assetId
  const name = asset?.name
  useEffect(() => {
    if (!registry || !assetType || !assetId) return
    registry.setPageAsset(id, { assetType, assetId, name: name ?? "" })
    return () => registry.setPageAsset(id, null)
  }, [registry, id, assetType, assetId, name])
}

/** Server pages render this to name their asset for drops. Renders nothing. */
export function DropPageAsset({ assetType, assetId, name }: { assetType: AssetType; assetId: string; name: string }) {
  useDropPageContext({ asset: { assetType, assetId, name } })
  return null
}
