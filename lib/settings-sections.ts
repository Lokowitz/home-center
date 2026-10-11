import { Bell, Bot, FileSearch, Mail, Palette, ToggleRight, Users } from "lucide-react"

// The sub-pages of Settings, chosen with ?tab= like the asset pages' tabs.
// Everyone gets their own email preferences and appearance; the rest is server setup.

export type SettingsSectionId = "notifications" | "appearance" | "features" | "mail" | "assistant" | "documents" | "users"

export type SettingsSection = {
  id: SettingsSectionId
  label: string
  description: string
  icon: React.ElementType
  adminOnly: boolean
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "notifications", label: "Notifications", description: "How often you're emailed about due items", icon: Bell, adminOnly: false },
  { id: "appearance", label: "Appearance", description: "How the site is laid out on this device", icon: Palette, adminOnly: false },
  { id: "features", label: "Features", description: "Turn optional parts of the site on or off", icon: ToggleRight, adminOnly: true },
  { id: "mail", label: "Mail server", description: "SMTP server used to send reminders", icon: Mail, adminOnly: true },
  { id: "assistant", label: "Assistant", description: "The AI assistant's model and behavior", icon: Bot, adminOnly: true },
  { id: "documents", label: "Documents & search", description: "Reading uploads, OCR and semantic search", icon: FileSearch, adminOnly: true },
  { id: "users", label: "Users", description: "Who can sign in, and their roles", icon: Users, adminOnly: true },
]

export function visibleSections(isAdmin: boolean): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => isAdmin || !s.adminOnly)
}

/** The requested section if this user may see it, else the first one. */
export function resolveSection(tab: string | string[] | undefined, isAdmin: boolean): SettingsSection {
  const visible = visibleSections(isAdmin)
  const want = Array.isArray(tab) ? tab[0] : tab
  return visible.find((s) => s.id === want) ?? visible[0]
}

export const settingsHref = (id: SettingsSectionId) => `/settings?tab=${id}`
