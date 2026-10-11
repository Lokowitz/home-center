import type { AssetType } from "@/app/generated/prisma/client"
import { extensionForFilename } from "@/lib/upload-types"

// Where a file dropped anywhere in the app goes, most specific first. The
// client side (components/drop/drop-provider.tsx) gathers the inputs from
// the DOM and the registered targets; the rules live here.

export type DropAsset = { assetType: AssetType; assetId: string; name: string }

/** An open dialog that takes attachments; `order` grows with each registration. */
/**
 * `isTop`: whether this dialog's popup is the topmost open modal — true/false
 * when its element is known, undefined when it isn't (then order decides).
 */
export type DialogDropTarget = { id: string; label: string; order: number; isTop?: boolean }

/** An on-page drop zone (an attachment list, the Intake drop zone) under the pointer. */
export type ZoneDropTarget = { id: string; label: string }

export type DropInput = {
  dialogTargets: DialogDropTarget[]
  /** Any modal dialog is open, with or without attachments. */
  modalOpen: boolean
  /** The innermost registered zone under the pointer, if any. */
  zone: ZoneDropTarget | null
  /** The asset whose page this is, if any. */
  pageAsset: DropAsset | null
  healthEnabled: boolean
}

export type DropDestination =
  | { kind: "dialog"; targetId: string; label: string }
  | { kind: "blocked"; label: string }
  | { kind: "zone"; targetId: string; label: string }
  | { kind: "intake"; asset: DropAsset | null; label: string }

export const BLOCKED_LABEL = "This form doesn't take files"

export function intakeLabel(asset: DropAsset | null): string {
  const name = asset?.name.trim()
  return name ? `Add to Intake — for ${name}` : "Add to Intake"
}

export function resolveDrop(input: DropInput): DropDestination {
  // 1. A dialog that takes files: the one on top, else the most recently opened
  // one whose position is unknown. One known to be underneath another dialog
  // never takes the drop — the dialog on top doesn't take files.
  // With no dialog actually open, a registered target is stale (its dialog is closing).
  const targets = input.modalOpen ? input.dialogTargets : []
  const onTop = targets.find((t) => t.isTop === true)
  const unknown = targets.filter((t) => t.isTop === undefined)
  const dialog = onTop ?? unknown.reduce<DialogDropTarget | null>((top, t) => (!top || t.order > top.order ? t : top), null)
  if (dialog) return { kind: "dialog", targetId: dialog.id, label: dialog.label }
  // 2. Any other dialog: the page behind it isn't the target.
  if (input.modalOpen) return { kind: "blocked", label: BLOCKED_LABEL }
  // 3. A drop zone on the page.
  if (input.zone) return { kind: "zone", targetId: input.zone.id, label: input.zone.label }
  // 4–5. Intake, with the page's asset when there is one (people only with Health on).
  const asset = input.pageAsset && (input.pageAsset.assetType !== "PERSON" || input.healthEnabled) ? input.pageAsset : null
  return { kind: "intake", asset, label: intakeLabel(asset) }
}

/** Only a drag carrying files opens the overlay; text, links and images from the page don't. */
export function dragCarriesFiles(types: ArrayLike<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files")
}

/** Accepted by type (lib/upload-types.ts), the same rule the server applies. */
export function splitDroppedFiles<T extends { name: string }>(files: T[]): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = []
  const rejected: T[] = []
  for (const f of files) (extensionForFilename(f.name) ? accepted : rejected).push(f)
  return { accepted, rejected }
}

export function intakeAddedMessage(count: number): string {
  return `Added ${count} file${count === 1 ? "" : "s"} to Intake`
}

const SHOWN_REJECTS = 3

export function rejectedFilesMessage(names: string[]): string {
  const quoted = names.map((n) => `"${n}"`)
  if (quoted.length > SHOWN_REJECTS + 1) {
    return `HomeCenter doesn't accept ${quoted.slice(0, SHOWN_REJECTS).join(", ")} and ${quoted.length - SHOWN_REJECTS} more.`
  }
  const list = quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}` : quoted[0] ?? ""
  return `HomeCenter doesn't accept ${list}.`
}
