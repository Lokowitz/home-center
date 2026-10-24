"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, CircleDashed, CircleOff, Minus, ScanText, Sparkles } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FieldHelp } from "@/components/ui/field-help"
import { setCaptureParser } from "@/lib/actions/inbox"
import { settingsHref } from "@/lib/settings-sections"
import {
  CAPTURE_OPTIONS as OPTIONS, captureParserAllowed, effectiveCaptureParser, type CaptureOption, type FillLevel,
} from "@/lib/capture-options"
import { cn } from "@/lib/utils"
import type { CaptureParser } from "@/app/generated/prisma/client"

const ICONS = { OFF: CircleOff, BASIC: ScanText, LLM: Sparkles } satisfies Record<CaptureParser, unknown>

const FILL: Record<FillLevel, { Icon: typeof Check; word: string; className: string }> = {
  yes: { Icon: Check, word: "filled in", className: "text-primary" },
  sometimes: { Icon: CircleDashed, word: "sometimes", className: "text-muted-foreground" },
  no: { Icon: Minus, word: "not filled in", className: "text-muted-foreground/60" },
}

/** Three bars of rising height, lit up to `strength`, like a signal meter. */
function StrengthMeter({ strength, chosen }: { strength: number; chosen: boolean }) {
  return (
    <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cn(
            "w-1.5 rounded-sm",
            bar === 1 ? "h-1.5" : bar === 2 ? "h-2.5" : "h-4",
            bar > strength ? "bg-muted" : chosen ? "bg-primary" : "bg-muted-foreground/50"
          )}
        />
      ))}
    </span>
  )
}

function FillList({ fills }: { fills: CaptureOption["fills"] }) {
  return (
    <ul className="space-y-1 text-xs">
      {fills.map(({ field, level }) => {
        const { Icon, word, className } = FILL[level]
        return (
          <li key={field} className={cn("flex items-center gap-1.5", level === "no" && "text-muted-foreground")}>
            <Icon className={cn("h-3.5 w-3.5 shrink-0", className)} strokeWidth={2.25} aria-hidden="true" />
            <span>
              {field}
              <span className="sr-only">: {word}</span>
              {level === "sometimes" && <span className="text-muted-foreground"> (sometimes)</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Settings → Documents → "Receipt reading" for Intake (the capture inbox). Saves on change. */
export function CaptureSettings({ initial, llmReady }: { initial: CaptureParser; llmReady: boolean }) {
  const [mode, setMode] = useState(initial)
  const [pending, start] = useTransition()

  function save(next: CaptureParser) {
    // One save at a time. The group isn't disabled meanwhile: that would drop
    // keyboard focus after every arrow-key change.
    if (pending) return
    const previous = mode
    setMode(next)
    start(async () => {
      const r = await setCaptureParser(next)
      if ("error" in r) {
        setMode(previous)
        toast.error(r.error)
        return
      }
      toast.success(`Receipt reading: ${OPTIONS.find((o) => o.value === next)?.label}.`)
    })
  }

  // A saved Local AI choice runs as Basic while the model isn't ready, so that's what shows as chosen.
  const shown = effectiveCaptureParser(mode, llmReady)
  const current = OPTIONS.find((o) => o.value === shown)

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Receipt reading
          <FieldHelp id="capture.parser" />
          {current && <Badge variant={shown === "OFF" ? "outline" : "secondary"}>{current.label}</Badge>}
        </CardTitle>
        <CardDescription>
          How <Link href="/intake" className="underline underline-offset-2">Intake</Link> fills in the date, total and shop of a
          receipt you add. Applies to new items; use Re-read on an item to read it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <fieldset className="grid gap-3 sm:grid-cols-3" aria-busy={pending}>
          <legend className="sr-only">Receipt reading, from least to most accurate</legend>
          {OPTIONS.map((o) => {
            const unavailable = !captureParserAllowed(o.value, llmReady)
            const chosen = shown === o.value
            const Icon = ICONS[o.value]
            return (
              <div
                key={o.value}
                className={cn(
                  "relative flex flex-col gap-3 rounded-xl border p-4 transition-colors duration-150",
                  "has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background",
                  chosen ? "border-primary bg-primary/5 ring-1 ring-primary" : !unavailable && "hover:border-foreground/30",
                  // The top step looks the part even unchosen — unless it can't be picked.
                  o.best && !chosen && !unavailable && "border-primary/40",
                  unavailable && "border-dashed bg-muted/30"
                )}
              >
                <label className={cn("flex items-center gap-2 text-sm font-semibold", unavailable ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")}>
                  {/* The span below stretches the label over the whole card; the radio stays a real, focusable input. */}
                  <input
                    type="radio"
                    name="capture-parser"
                    className="sr-only"
                    value={o.value}
                    checked={chosen}
                    disabled={unavailable}
                    onChange={() => save(o.value)}
                  />
                  <span className="absolute inset-0 rounded-xl" aria-hidden="true" />
                  <Icon className={cn("h-4 w-4 shrink-0", chosen || (o.best && !unavailable) ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                  {o.label}
                  {o.best && <Badge variant={unavailable ? "outline" : "default"} className="ml-auto">Best</Badge>}
                </label>
                <div className={cn("flex flex-col gap-3", unavailable && "opacity-60")}>
                  <StrengthMeter strength={o.strength} chosen={chosen} />
                  <FillList fills={o.fills} />
                </div>
                {unavailable ? (
                  <p className="relative text-xs text-muted-foreground">
                    {mode === o.value ? "Chosen, but the assistant's model isn't set up or is off, so Basic runs for now. " : "Needs the assistant's model. "}
                    <Link href={settingsHref("assistant")} className="font-medium text-primary underline underline-offset-2">Set it up under Assistant</Link>.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{o.hint}</p>
                )}
              </div>
            )
          })}
        </fieldset>
      </CardContent>
    </Card>
  )
}
