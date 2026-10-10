"use client"

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ASSET_TYPES, assetLabel } from "@/lib/assets"
import { assetKey } from "@/lib/inbox-form"
import type { AssetType, MeterUnit } from "@/app/generated/prisma/client"

export type InboxAssetOption = { type: AssetType; id: string; name: string; meterUnit?: MeterUnit }
export type InboxReminderOption = { id: string; title: string; assetType: AssetType; assetId: string }

const GROUP_LABEL: Record<AssetType, string> = { PROPERTY: "Properties", VEHICLE: "Vehicles", EQUIPMENT: "Equipment", PERSON: "People" }

/** Every asset, grouped by kind. The value is an assetKey ("TYPE:id"), or "" for none chosen. */
export function AssetSelect({
  assets,
  value,
  onChange,
  id,
  invalid,
}: {
  assets: InboxAssetOption[]
  value: string
  onChange: (key: string) => void
  id?: string
  invalid?: boolean
}) {
  const byKey = new Map(assets.map((a) => [assetKey(a.type, a.id), a]))
  return (
    <Select value={value || null} onValueChange={(v) => onChange(typeof v === "string" ? v : "")}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder="Choose an asset">
          {(v: string | null) => {
            const a = v ? byKey.get(v) : undefined
            return a ? `${a.name} · ${assetLabel[a.type]}` : "Choose an asset"
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ASSET_TYPES.map((type) => {
          const group = assets.filter((a) => a.type === type)
          if (!group.length) return null
          return (
            <SelectGroup key={type}>
              <SelectLabel>{GROUP_LABEL[type]}</SelectLabel>
              {group.map((a) => (
                <SelectItem key={a.id} value={assetKey(a.type, a.id)}>{a.name}</SelectItem>
              ))}
            </SelectGroup>
          )
        })}
      </SelectContent>
    </Select>
  )
}
