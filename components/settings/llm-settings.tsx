"use client"

import { useEffect, useState, useTransition } from "react"
import { useForm, useWatch } from "react-hook-form"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { FieldHelp } from "@/components/ui/field-help"
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@/components/ui/form"
import { Check, TriangleAlert } from "lucide-react"
import { settingsHref } from "@/lib/settings-sections"
import { testLlmConnection, updateLlmSettings, updateLlmSwitches, type LlmSwitches } from "@/lib/actions/llm-settings"
import { DEFAULT_TIMEOUT_SECONDS, DEFAULT_TOOL_ROUNDS, TOOL_ROUNDS_RANGE, LLM_PRESETS, isOffNetworkUrl } from "@/lib/llm/settings-schema"

type Values = {
  enabled: boolean
  hidden: boolean
  baseUrl: string
  apiKey: string
  model: string
  temperature: string
  maxTokens: string
  systemPrompt: string
  timeoutSeconds: string
  maxToolRounds: string
  extraBody: string
  documentsEnabled: boolean
  healthDocumentsEnabled: boolean
}

export function LlmSettings({
  initial,
  hasStoredKey,
  keyUnreadable,
  ready,
  indexingEnabled,
  healthEnabled,
}: {
  initial: Omit<Values, "apiKey">
  hasStoredKey: boolean
  keyUnreadable: boolean
  ready: boolean
  /** Document switches only matter while indexing is on (Settings → Documents). */
  indexingEnabled: boolean
  /** Health on or off under Settings → Features. */
  healthEnabled: boolean
}) {
  const form = useForm<Values>({ defaultValues: { ...initial, apiKey: "" } })
  const [clearApiKey, setClearApiKey] = useState(false)
  const [testing, startTest] = useTransition()
  const [switchPending, startSwitch] = useTransition()
  const [switchStatus, setSwitchStatus] = useState<"idle" | "saved">("idle")
  const [enabled, hidden, documentsEnabled, healthDocumentsEnabled, baseUrl] = useWatch({
    control: form.control,
    name: ["enabled", "hidden", "documentsEnabled", "healthDocumentsEnabled", "baseUrl"],
  })

  useEffect(() => {
    if (switchStatus !== "saved") return
    const t = setTimeout(() => setSwitchStatus("idle"), 2000)
    return () => clearTimeout(t)
  }, [switchStatus])

  /** Shows the change at once, saves it, and puts it back if the save is refused. */
  function toggle(patch: Partial<LlmSwitches>) {
    const keys = ["enabled", "hidden", "documentsEnabled", "healthDocumentsEnabled"] as const
    const previous = Object.fromEntries(keys.map((k) => [k, form.getValues(k)])) as LlmSwitches
    const apply = (v: Partial<LlmSwitches>) => {
      for (const k of keys) if (v[k] !== undefined) form.setValue(k, v[k]!, { shouldDirty: false })
    }
    apply(patch)
    setSwitchStatus("idle")
    startSwitch(async () => {
      const result = await updateLlmSwitches(patch)
      if ("error" in result) {
        apply(previous)
        toast.error(result.error)
        return
      }
      apply(result.values)
      setSwitchStatus("saved")
    })
  }

  async function onSubmit(values: Values) {
    const result = await updateLlmSettings({ ...values, clearApiKey })
    if ("error" in result) {
      toast.error(result.error)
      return
    }
    toast.success("Assistant settings saved.")
    form.setValue("apiKey", "")
    setClearApiKey(false)
  }

  function runTest() {
    startTest(async () => {
      const result = await testLlmConnection({ ...form.getValues(), clearApiKey })
      if ("error" in result) {
        toast.error(result.error, { duration: 15000 })
        return
      }
      if (result.toolCalling) toast.success(`Connected to ${result.model} — tool calling works.`)
      else
        toast.warning(
          `Connected to ${result.model}, but it didn't call the test tool. It may not support tool calling, which the assistant needs.`,
          { duration: 15000 }
        )
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Assistant
          {ready ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          Lets everyone ask questions about HomeCenter&apos;s data in chat. Works with any OpenAI-compatible server —
          OpenAI, Ollama, LM Studio, OpenRouter. Questions and the records needed to answer them are sent to this
          server, including health records; use a local model if that matters to you.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {keyUnreadable && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            The saved API key can&apos;t be decrypted — this happens if <code className="text-xs">AUTH_SECRET</code>{" "}
            changed. Enter it again.
          </p>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Switches</p>
                <SaveStatus status={switchPending ? "saving" : switchStatus} />
              </div>
              <div className="space-y-3">
                <SwitchRow
                  label="Turn on the assistant"
                  help="llm.enabled"
                  checked={enabled}
                  disabled={switchPending}
                  onChange={(v) => toggle({ enabled: v })}
                />
                <SwitchRow
                  label="Hide the assistant from the nav menu and the top-right button"
                  help="llm.hidden"
                  nested
                  checked={hidden}
                  disabled={switchPending}
                  onChange={(v) => toggle({ hidden: v })}
                />
                <SwitchRow
                  label="Let the assistant read uploaded documents"
                  help="llm.documents"
                  checked={documentsEnabled && enabled}
                  disabled={switchPending || !enabled || !indexingEnabled}
                  disabledReason={!enabled ? "turn on the assistant first" : undefined}
                  onChange={(v) => toggle({ documentsEnabled: v })}
                  hint={
                    indexingEnabled
                      ? "Document text is sent to the configured LLM server when it's relevant to a question."
                      : "Turn on document indexing first (Settings → Documents & search)."
                  }
                />
                <SwitchRow
                  label="Include health record documents"
                  help="llm.health-documents"
                  nested
                  checked={healthDocumentsEnabled && healthEnabled && enabled}
                  disabled={switchPending || !enabled || !healthEnabled || !indexingEnabled || !documentsEnabled}
                  disabledReason={
                    !enabled ? (
                      "turn on the assistant first"
                    ) : !healthEnabled ? (
                      <>
                        Health is turned off under{" "}
                        <Link href={settingsHref("features")} className="underline underline-offset-2 hover:text-foreground">
                          Features
                        </Link>
                      </>
                    ) : indexingEnabled && !documentsEnabled ? (
                      "needs the option above"
                    ) : undefined
                  }
                  onChange={(v) => toggle({ healthDocumentsEnabled: v })}
                  hint="Files on anything that belongs to a person: their visits, reminders and warranties, plus conditions, observations, medications, allergies and immunizations. With a cloud provider, their text leaves this server."
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">These save as soon as you change them.</p>
            </div>

            <div className="border-t pt-5">
              <h3 className="font-heading text-base font-semibold">Advanced settings</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The server the assistant talks to and how it behaves. Changes here are saved with the Save button.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="baseUrl" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="llm.base-url">Base URL</FormLabel>
                  <FormControl><Input placeholder="https://api.openai.com/v1" {...field} /></FormControl>
                  <FormDescription className="text-xs">
                    Fill from:{" "}
                    {LLM_PRESETS.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && " · "}
                        <button
                          type="button"
                          className="underline hover:text-foreground"
                          onClick={() => form.setValue("baseUrl", p.baseUrl, { shouldDirty: true })}
                        >
                          {p.label}
                        </button>
                      </span>
                    ))}
                    . In Docker, use the host&apos;s address instead of localhost.
                  </FormDescription>
                  {isOffNetworkUrl(baseUrl) && (
                    <p className="flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" />
                      <span>
                        This server is outside your network. Questions, the records needed to answer them and receipts
                        sent for reading will go to this provider{healthEnabled ? ", including health records" : ""}.
                        Check its privacy terms, or use a local model such as Ollama or LM Studio.
                      </span>
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="model" render={({ field }) => (
                <FormItem>
                  <FormLabel help="llm.model">Model</FormLabel>
                  <FormControl><Input placeholder="gpt-4o-mini" {...field} /></FormControl>
                  <FormDescription className="text-xs">Must support tool (function) calling.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="apiKey" render={({ field }) => (
                <FormItem>
                  <FormLabel help="llm.api-key">API key</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={hasStoredKey ? "•••••••• (unchanged)" : "Not needed for local servers"}
                      disabled={clearApiKey}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Stored encrypted, and only sent to the server it was saved for — a saved key is dropped when the base URL moves to another server.
                    {hasStoredKey && (
                      <button type="button" className="ml-1 underline hover:text-foreground" onClick={() => setClearApiKey((c) => !c)}>
                        {clearApiKey ? "Keep saved key" : "Remove saved key"}
                      </button>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="temperature" render={({ field }) => (
                <FormItem>
                  <FormLabel help="llm.temperature">Temperature</FormLabel>
                  <FormControl><Input type="number" step="0.1" min={0} max={2} placeholder="Provider default" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="maxTokens" render={({ field }) => (
                <FormItem>
                  <FormLabel help="llm.max-tokens">Max tokens</FormLabel>
                  <FormControl><Input type="number" min={1} max={32000} placeholder="Provider default" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="timeoutSeconds" render={({ field }) => (
                <FormItem>
                  <FormLabel help="llm.timeout">Time limit per question (seconds)</FormLabel>
                  <FormControl><Input type="number" min={30} max={900} placeholder={String(DEFAULT_TIMEOUT_SECONDS)} {...field} /></FormControl>
                  <FormDescription className="text-xs">
                    Raise it for slow local models. Once a reply starts, it also stops if the server then sends nothing for 60 seconds.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="maxToolRounds" render={({ field }) => (
                <FormItem>
                  <FormLabel help="llm.tool-rounds">Lookup rounds per question</FormLabel>
                  <FormControl>
                    <Input type="number" min={TOOL_ROUNDS_RANGE.min} max={TOOL_ROUNDS_RANGE.max} placeholder={String(DEFAULT_TOOL_ROUNDS)} {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    How many times the assistant may go back for more data before it must answer. More helps follow-up and
                    multi-step questions; simple questions stop early either way.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="systemPrompt" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="llm.system-prompt">Extra instructions</FormLabel>
                  <FormControl><Textarea rows={3} maxLength={4000} placeholder="e.g. Keep answers short." {...field} /></FormControl>
                  <FormDescription className="text-xs">Added to the assistant&apos;s built-in instructions.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="extraBody" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="llm.extra-body">Extra request JSON</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={2000} className="font-mono text-xs" placeholder='{"chat_template_kwargs": {"enable_thinking": true}}' {...field} />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Optional fields sent with every request, for settings your server supports — for example turning on a
                    model&apos;s thinking (llama.cpp, vLLM) or <code className="text-xs">reasoning_effort</code> (OpenAI). Leave blank if unsure.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={form.formState.isSubmitting || switchPending}>
                {form.formState.isSubmitting ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" disabled={testing} onClick={runTest}>
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <Link href="/settings/assistant-test" className={buttonVariants({ variant: "ghost" })}>
                Run model tests →
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              The test uses what&apos;s typed above, so you can try settings before saving.
            </p>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

function SwitchRow({
  label, help, checked, disabled, disabledReason, onChange, hint, nested,
}: {
  label: string
  /** lib/field-help id for the "?" beside the label. */
  help: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  hint?: string
  /** Why it can't be changed right now, shown beside the label. */
  disabledReason?: React.ReactNode
  /** Depends on the option above it: indented beneath it. */
  nested?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className={`flex items-center gap-2 text-sm ${nested ? "ml-6 font-normal" : "font-medium"} ${disabled ? "opacity-60" : ""}`}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{label}</span>
        </label>
        <FieldHelp id={help} />
      </div>
      {disabledReason && (
        <p className={`${nested ? "ml-12" : "ml-6"} text-xs font-medium text-muted-foreground`}>({disabledReason})</p>
      )}
      {hint && <p className={`${nested ? "ml-12" : "ml-6"} text-xs text-muted-foreground`}>{hint}</p>}
    </div>
  )
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" }) {
  if (status === "idle") return null
  return (
    <span role="status" className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {status === "saving" ? (
        "Saving…"
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Saved
        </>
      )}
    </span>
  )
}
