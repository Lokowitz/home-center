"use client"

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { ChevronLeft, ChevronRight, Palette } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { THEMES, nextTheme, prevTheme, themeLabel } from "@/lib/themes"

const noSubscribe = () => () => {}

// Below sm only the palette shows: there's no room on a phone header for three controls.
const arrowClass =
  "hidden sm:inline-flex h-9 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"

/**
 * Header theme picker: arrows step through the themes (wrapping), the name in
 * the middle opens the full list. Below sm the arrows go and the name collapses
 * to a palette button that opens the list, so the header still fits on a phone.
 */
export function ThemeNavigator() {
  const { theme, setTheme } = useTheme()
  // false during SSR and hydration, true after — the theme is only known on the client.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false)

  if (!mounted) {
    return <div className="h-10 w-10 sm:h-9 sm:w-[9.5rem]" aria-hidden="true" />
  }

  const current = theme ?? "system"
  const label = themeLabel(current)

  return (
    <div className="flex items-center">
      <button type="button" onClick={() => setTheme(prevTheme(current))} className={arrowClass} aria-label="Previous theme">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground sm:h-9 sm:w-24 sm:px-1"
          aria-label={`Choose theme, current: ${label}`}
        >
          <Palette className="h-4 w-4 sm:hidden" />
          <span className="hidden truncate sm:block">{label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-44">
          <DropdownMenuRadioGroup value={current} onValueChange={(value) => setTheme(String(value))}>
            {THEMES.map((t) => (
              <DropdownMenuRadioItem key={t.id} value={t.id}>
                {t.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" onClick={() => setTheme(nextTheme(current))} className={arrowClass} aria-label="Next theme">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
