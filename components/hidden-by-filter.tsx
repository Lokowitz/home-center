"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { propertyFilterCookie } from "@/lib/property-filter"

/** Shown on a detail page whose asset the property filter hides, with a way out. */
export function HiddenByFilter({ propertyName, ownerName }: { propertyName: string; ownerName?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function showAll() {
    document.cookie = propertyFilterCookie(null)
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-5">
        <p className="text-sm">
          {ownerName
            ? `Hidden by the property filter. This belongs to ${ownerName}, and ${propertyName} is selected.`
            : `Hidden by the property filter. This isn't linked to ${propertyName}, and ${propertyName} is selected.`}
        </p>
        <Button variant="outline" size="sm" onClick={showAll} disabled={pending}>Show all properties</Button>
      </CardContent>
    </Card>
  )
}
