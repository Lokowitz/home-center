"use client"

import Link from "next/link"
import { markNotificationRead } from "@/lib/actions/notifications"

/** The title area of a row on /notifications: opening it marks it read, like the bell. */
export function NotificationRowLink({ id, href, isRead, children }: { id: string; href: string; isRead: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={() => { if (!isRead) void markNotificationRead(id) }} className="block hover:underline">
      {children}
    </Link>
  )
}
