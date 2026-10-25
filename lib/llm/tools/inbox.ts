import { z } from "zod/v4"
import { prisma } from "@/lib/prisma"
import { loadAssetIndex } from "@/lib/assets-server"
import { assetHref } from "@/lib/assets"
import { INBOX_TOOL_DESCRIPTION, inboxToolResult } from "../inbox"
import { defineTool, type RegisteredTool } from "./registry"
import { scopedNames } from "../property-scope"

// Read-only: the assistant can say what's waiting in Intake and point to it,
// never file anything (the roadmap keeps write tools out of the assistant).
// Built per request because whether person-suggested items are shown depends on
// the health-documents setting; that filter is applied in code, not by the model.

export function inboxTool(includeHealth: boolean): RegisteredTool {
  return defineTool({
    name: "intake",
    description: INBOX_TOOL_DESCRIPTION,
    schema: z.object({}),
    label: () => "Checking Intake…",
    async run(_, ctx) {
      // Unlike listInboxItems, no clean-up of abandoned uploads: a tool call only reads.
      const [rows, index] = await Promise.all([
        prisma.inboxItem.findMany({
          where: { attachments: { some: {} } },
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true, status: true, parsedDate: true, parsedTotal: true, parsedVendor: true, error: true,
            suggestedAssetType: true, suggestedAssetId: true, suggestedReason: true,
            attachments: { orderBy: { uploadedAt: "asc" }, select: { originalName: true } },
          },
        }),
        // With Health off it has no people, so a person's name can't leak through it.
        loadAssetIndex(),
      ])
      // A suggestion the property filter hides isn't named, as on the Intake page.
      const names = scopedNames(index.names, ctx.scope)
      return inboxToolResult(
        rows.map((r) => {
          const name = r.suggestedAssetType && r.suggestedAssetId ? names[r.suggestedAssetType]?.[r.suggestedAssetId] : undefined
          return {
            createdAt: r.createdAt,
            status: r.status,
            parsedDate: r.parsedDate,
            parsedTotal: r.parsedTotal,
            parsedVendor: r.parsedVendor,
            error: r.error,
            suggestedAssetType: r.suggestedAssetType,
            suggestedAsset: name && r.suggestedAssetType && r.suggestedAssetId
              ? { name, href: assetHref(r.suggestedAssetType, r.suggestedAssetId) }
              : null,
            suggestedReason: name ? r.suggestedReason : null,
            files: r.attachments.map((a) => a.originalName),
          }
        }),
        { includeHealth }
      )
    },
  })
}
