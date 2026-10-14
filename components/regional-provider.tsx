"use client"

import { createContext, useContext, useMemo } from "react"
import { createFormatter, type Formatter, type Regional } from "@/lib/regional"

const RegionalContext = createContext<Formatter | null>(null)

export function RegionalProvider({ value, children }: { value: Regional; children: React.ReactNode }) {
  const fmt = useMemo(() => createFormatter(value), [value])
  return <RegionalContext.Provider value={fmt}>{children}</RegionalContext.Provider>
}

/** The household formatter. Throws outside a RegionalProvider so a page can't silently show defaults. */
export function useFormat(): Formatter {
  const fmt = useContext(RegionalContext)
  if (!fmt) throw new Error("useFormat() needs a <RegionalProvider> above it")
  return fmt
}
