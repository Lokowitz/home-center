import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { TemplatePicker } from "@/components/maintenance/template-picker"
import { assetHref } from "@/lib/assets"
import { templatesFor } from "@/lib/maintenance-templates"
import { loadTemplateTarget } from "@/lib/maintenance-templates-server"
import { prisma } from "@/lib/prisma"
import { loadPropertyScope } from "@/lib/property-filter-server"
import { assetInScope } from "@/lib/property-filter"
import { HiddenByFilter } from "@/components/hidden-by-filter"
import type { AssetType } from "@/app/generated/prisma/client"

/** Body of /assets/{type}/[id]/reminders: pick default reminders for one asset. */
export async function TemplatePickerPage({ assetType, assetId }: { assetType: AssetType; assetId: string }) {
  const target = await loadTemplateTarget(assetType, assetId)
  if (!target) notFound()

  const scope = await loadPropertyScope()
  if (!assetInScope(scope, assetType, assetId)) {
    const owner = target.propertyId
      ? await prisma.property.findUnique({ where: { id: target.propertyId }, select: { name: true } })
      : null
    return <HiddenByFilter propertyName={scope!.propertyName} ownerName={owner?.name} />
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={assetHref(assetType, assetId)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {target.name}
        </Link>
        <h1 className="font-heading text-2xl font-semibold">Add default reminders</h1>
        <p className="text-sm text-muted-foreground">
          Common intervals to start from, not manufacturer schedules. Uncheck what doesn&apos;t apply and adjust the rest.
          Each one is first due one interval from today.
        </p>
      </div>
      <TemplatePicker
        assetType={assetType}
        assetId={assetId}
        templates={templatesFor(target.asset)}
        existingTitles={target.existingTitles}
        meterUnit={target.asset.type === "VEHICLE" ? target.asset.meterUnit : null}
      />
    </div>
  )
}
