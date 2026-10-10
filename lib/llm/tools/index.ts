import type { RegisteredTool } from "./registry"
import {
  assetHistoryTool, costSummaryTool, healthAlertsTool, maintenanceStatusTool, observationLogTool, searchTool, warrantyStatusTool,
} from "./shortcuts"
import { aggregateTool, findRecordsTool, getRecordTool } from "./generic"
import { documentTools } from "./documents"
import { inboxTool } from "./inbox"
import type { DocumentAccess } from "@/lib/documents/tool-helpers"

const SHORTCUT_TOOLS: RegisteredTool[] = [
  searchTool,
  costSummaryTool,
  assetHistoryTool,
  maintenanceStatusTool,
  warrantyStatusTool,
  healthAlertsTool,
  observationLogTool,
]
const GENERIC_TOOLS: RegisteredTool[] = [findRecordsTool, getRecordTool, aggregateTool]

const HEALTH_TOOLS = new Set<RegisteredTool>([healthAlertsTool, observationLogTool])

/**
 * The chat's tools: document tools go between the shortcuts and the generic
 * tools when allowed. With Health off its own shortcuts are left out. The
 * read-only inbox tool is always there; it shows items that look like a
 * person's only when health documents may go to the model (`healthDocuments`,
 * which doesn't depend on document indexing being on).
 * Shortcuts first: weaker models tend to pick from the top of the list.
 */
export function chatTools(access: DocumentAccess, health = true, healthDocuments = access.includeHealth): RegisteredTool[] {
  const shortcuts = health ? SHORTCUT_TOOLS : SHORTCUT_TOOLS.filter((t) => !HEALTH_TOOLS.has(t))
  return [
    ...shortcuts,
    inboxTool(health && healthDocuments),
    ...(access.enabled ? documentTools(access.includeHealth) : []),
    ...GENERIC_TOOLS,
  ]
}

/**
 * The tools the admin model test offers: the chat's own list with Health on and
 * document indexing off (an opt-in feature whose tools need indexed files). Only
 * names, descriptions and schemas are used — the test serves made-up results.
 */
export const MODEL_TEST_TOOLS: RegisteredTool[] = chatTools({ enabled: false, includeHealth: true })
