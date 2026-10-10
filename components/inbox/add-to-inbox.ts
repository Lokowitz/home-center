"use client"

import { toast } from "sonner"
import { createInboxItem, discardInboxItem } from "@/lib/actions/inbox"
import { uploadFile } from "@/lib/upload-client"
import { extensionForFilename } from "@/lib/upload-types"

// One file → one inbox item, shared by the Inbox drop zone and the assistant's
// attach button so both doors behave the same.

/**
 * Creates the item and uploads the file into it, with a progress toast.
 * Resolves true when it landed. `successToast: false` when the caller shows
 * its own confirmation (the chat writes a line in the transcript instead).
 */
export async function addFileToInbox(file: File, { successToast = true }: { successToast?: boolean } = {}): Promise<boolean> {
  const id = `upload-${file.name}-${file.size}-${file.lastModified}`
  if (!extensionForFilename(file.name)) {
    toast.error(`"${file.name}" isn't a file type HomeCenter accepts.`, { id })
    return false
  }
  toast.loading(`Uploading ${file.name}…`, { id })
  let itemId: string | null = null
  try {
    itemId = (await createInboxItem()).id
    await uploadFile(file, "INBOX", itemId)
    if (successToast) toast.success(`Added ${file.name}. Reading it now.`, { id })
    else toast.dismiss(id)
    return true
  } catch (error) {
    // Don't leave an empty item behind (it would sit there "Uploading…").
    if (itemId) await discardInboxItem(itemId).catch(() => {})
    toast.error(error instanceof Error ? error.message : `Couldn't upload ${file.name}.`, { id })
    return false
  }
}
