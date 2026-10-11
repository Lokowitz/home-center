"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Inbox } from "lucide-react"
import { InboxItemCard } from "@/components/inbox/inbox-item-card"
import type { InboxAssetOption, InboxReminderOption } from "@/components/inbox/asset-select"
import { hasPendingItems } from "@/lib/inbox-form"
// Type only: inbox-server reaches Prisma.
import type { InboxListItem } from "@/lib/inbox-server"

const POLL_MS = 3000

export function InboxList({
  items,
  householdNames,
  assets,
  reminders,
}: {
  items: InboxListItem[]
  householdNames: string[]
  assets: InboxAssetOption[]
  reminders: InboxReminderOption[]
}) {
  const router = useRouter()
  const pending = hasPendingItems(items)

  // Files are read in the background; refresh until every item has settled.
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [pending, router])

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
        <p className="font-medium">Nothing waiting</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Receipts and invoices you add here wait until you file them on a vehicle, property or piece of equipment.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          <InboxItemCard item={item} householdNames={householdNames} assets={assets} reminders={reminders} />
        </li>
      ))}
    </ul>
  )
}
