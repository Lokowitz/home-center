import type { FieldHelpMap } from "./types"
import { ASSET_HELP } from "./assets"
import { AUTH_HELP } from "./auth"
import { EQUIPMENT_HELP } from "./equipment"
import { HEALTH_HELP } from "./health"
import { INSURANCE_HELP } from "./insurance"
import { RECORD_HELP } from "./records"
import { REMINDER_HELP } from "./reminders"
import { SETTINGS_HELP } from "./settings"
import { SYSTEM_HELP } from "./system"

export type { FieldHelpEntry, FieldHelpMap } from "./types"

/** Every field's help, by "area.field" id. One file per area; see types.ts for the writing rules. */
export const FIELD_HELP: FieldHelpMap = {
  ...REMINDER_HELP,
  ...EQUIPMENT_HELP,
  ...ASSET_HELP,
  ...RECORD_HELP,
  ...INSURANCE_HELP,
  ...HEALTH_HELP,
  ...SETTINGS_HELP,
  ...SYSTEM_HELP,
  ...AUTH_HELP,
}
