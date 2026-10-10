"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { setCaptureParser } from "@/lib/actions/inbox"
import { settingsHref } from "@/lib/settings-sections"
import type { CaptureParser } from "@/app/generated/prisma/client"

const OPTIONS: { value: CaptureParser; label: string; hint: string }[] = [
  { value: "OFF", label: "Off", hint: "Inbox items start blank; you fill in every field." },
  { value: "BASIC", label: "Basic", hint: "Built in and offline. Finds the date, total and shop on most printed receipts." },
  {
    value: "LLM",
    label: "Local AI",
    hint: "Sends the receipt's extracted text to the model configured under Assistant. Usually more accurate. Falls back to Basic if the model can't answer.",
  },
]

/** Settings → Documents → "Receipt reading" for the capture inbox. Saves on change. */
export function CaptureSettings({ initial, llmReady }: { initial: CaptureParser; llmReady: boolean }) {
  const [mode, setMode] = useState(initial)
  const [pending, start] = useTransition()

  function save(next: CaptureParser) {
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

  const current = OPTIONS.find((o) => o.value === mode)

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Receipt reading
          {current && <Badge variant={mode === "OFF" ? "outline" : "secondary"}>{current.label}</Badge>}
        </CardTitle>
        <CardDescription>
          How the <Link href="/inbox" className="underline underline-offset-2">Inbox</Link> fills in the date, total and shop of a
          receipt you add. Applies to new items; use Re-read on an item to read it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        <fieldset className="space-y-3" disabled={pending}>
          <legend className="sr-only">Receipt reading</legend>
          {OPTIONS.map((o) => {
            const unavailable = o.value === "LLM" && !llmReady
            return (
              <div key={o.value} className="space-y-0.5">
                <label className="flex items-center gap-2 text-sm font-medium has-disabled:opacity-60">
                  <input
                    type="radio"
                    name="capture-parser"
                    className="h-4 w-4 accent-primary"
                    value={o.value}
                    checked={mode === o.value}
                    // Already chosen stays selectable so it can be left, even if the LLM went away.
                    disabled={unavailable && mode !== o.value}
                    onChange={() => save(o.value)}
                  />
                  {o.label}
                </label>
                <p className="ml-6 text-xs text-muted-foreground">{o.hint}</p>
                {unavailable && (
                  <p className="ml-6 text-xs text-muted-foreground">
                    {mode === o.value ? "The assistant's model isn't set up or is turned off, so Basic is used for now. " : "Needs the assistant's model. "}
                    <Link href={settingsHref("assistant")} className="underline underline-offset-2">Set it up under Assistant</Link>.
                  </p>
                )}
              </div>
            )
          })}
        </fieldset>
      </CardContent>
    </Card>
  )
}
