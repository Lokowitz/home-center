import type { CaptureParser } from "@/app/generated/prisma/client"

// Settings → Receipt reading: the three choices as a ladder, weakest first.

export type FillLevel = "yes" | "sometimes" | "no"
export type CaptureOption = {
  value: CaptureParser
  label: string
  /** Bars lit on the three-bar meter. */
  strength: 0 | 1 | 2 | 3
  /** What it fills in on a new Intake item. */
  fills: { field: "Date" | "Total" | "Shop"; level: FillLevel }[]
  hint: string
  best?: boolean
}

const fills = (date: FillLevel, total: FillLevel, shop: FillLevel): CaptureOption["fills"] => [
  { field: "Date", level: date },
  { field: "Total", level: total },
  { field: "Shop", level: shop },
]

export const CAPTURE_OPTIONS: CaptureOption[] = [
  { value: "OFF", label: "Off", strength: 0, fills: fills("no", "no", "no"), hint: "You type every field." },
  { value: "BASIC", label: "Basic", strength: 2, fills: fills("yes", "yes", "sometimes"), hint: "Built in, offline and instant." },
  {
    value: "LLM",
    label: "Local AI",
    strength: 3,
    fills: fills("yes", "yes", "yes"),
    hint: "Reads the text with the model set up under Assistant. Falls back to Basic.",
    best: true,
  },
]

/** Local AI needs the assistant's model set up and on; the others are always allowed. */
export function captureParserAllowed(mode: CaptureParser, llmReady: boolean): boolean {
  return mode !== "LLM" || llmReady
}

/** What actually reads receipts: a saved Local AI choice runs as Basic while the model isn't ready. */
export function effectiveCaptureParser(mode: CaptureParser, llmReady: boolean): CaptureParser {
  return captureParserAllowed(mode, llmReady) ? mode : "BASIC"
}

export function captureOption(value: CaptureParser): CaptureOption {
  return CAPTURE_OPTIONS.find((o) => o.value === value) ?? CAPTURE_OPTIONS[1]
}
