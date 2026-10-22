"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { updateFeatureSettings } from "@/lib/actions/feature-settings"

type Values = { healthEnabled: boolean; roomsEnabled: boolean; equipmentTabEnabled: boolean }

const FEATURE_NAMES = { healthEnabled: "Health", roomsEnabled: "Rooms", equipmentTabEnabled: "Equipment tab" } as const

export function FeatureSettings({ initial }: { initial: Values }) {
  const [values, setValues] = useState(initial)
  const [pending, start] = useTransition()

  function save(next: Values) {
    const previous = values
    setValues(next)
    start(async () => {
      const r = await updateFeatureSettings(next)
      if ("error" in r) {
        setValues(previous)
        toast.error(r.error)
        return
      }
      // One switch changes per save: say which, and which way.
      const changed = (["healthEnabled", "roomsEnabled", "equipmentTabEnabled"] as const).find((k) => next[k] !== previous[k])
      if (changed) toast.success(`${FEATURE_NAMES[changed]} turned ${next[changed] ? "on" : "off"}.`)
    })
  }

  const on = values.healthEnabled
  const roomsOn = values.roomsEnabled
  const equipmentTabOn = values.equipmentTabEnabled

  return (
    <div className="space-y-6">
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Health
          {on ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          People, providers and insurance, with everyone&apos;s visits, reminders, warranties and health records.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={on}
            disabled={pending}
            onChange={(e) => save({ ...values, healthEnabled: e.target.checked })}
          />
          Show the Health section
        </label>
        <p className="ml-6 text-xs text-muted-foreground">
          Turned off, it disappears from the menu, the dashboard, lists, search, notifications and the assistant. Nothing
          is deleted — turn it back on and it all returns.
        </p>
      </CardContent>
    </Card>

    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Rooms
          {roomsOn ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>Rooms inside properties: paint, flooring, photos.</CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={roomsOn}
            disabled={pending}
            onChange={(e) => save({ ...values, roomsEnabled: e.target.checked })}
          />
          Show Rooms
        </label>
        <p className="ml-6 text-xs text-muted-foreground">
          Turned off, rooms disappear from properties, equipment and records. Nothing is deleted — turn it back on and it
          all returns.
        </p>
      </CardContent>
    </Card>

    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Equipment tab
          {equipmentTabOn ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>A property&apos;s equipment, and each room&apos;s, listed and edited in place.</CardDescription>
      </CardHeader>
      <CardContent className="px-5 space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={equipmentTabOn}
            disabled={pending}
            onChange={(e) => save({ ...values, equipmentTabEnabled: e.target.checked })}
          />
          Show the Equipment tab on properties and rooms
        </label>
        <p className="ml-6 text-xs text-muted-foreground">
          Turned off, the Equipment tab disappears from properties and from the room window. Equipment itself is
          untouched and still reachable from the Equipment page.
        </p>
      </CardContent>
    </Card>

    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Install as an app</CardTitle>
        <CardDescription>
          Add HomeCenter to your iPhone, iPad or phone Home Screen so it opens like an app.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <Link href="/settings/install" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          How to install →
        </Link>
      </CardContent>
    </Card>
    </div>
  )
}
