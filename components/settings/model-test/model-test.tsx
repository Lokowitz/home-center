"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldHelp } from "@/components/ui/field-help"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatSeconds } from "./summary"
import { EXTRA_PRESETS, type ModelTestCatalogEntry } from "./types"
import { ResultsList } from "./results-list"
import { RunHistory } from "./run-history"
import { useModelTest, type StageInfo } from "./use-model-test"

const REPEAT_OPTIONS = [1, 2, 3, 5]

export function ModelTest({
  savedModel,
  savedTemperature,
  savedExtraBody,
  savedRounds,
  defaultRounds,
  serverHost,
  timeoutSeconds,
  catalog,
  stages,
  today,
}: {
  savedModel: string
  savedTemperature: string
  savedExtraBody: string
  savedRounds: string
  defaultRounds: number
  serverHost: string
  timeoutSeconds: number
  catalog: ModelTestCatalogEntry[]
  stages: StageInfo[]
  today: string
}) {
  const t = useModelTest({ savedModel, savedTemperature, savedExtraBody, savedRounds, catalog, stages })

  const started = t.liveSummary.total > 0 || t.startLine !== null
  const progressPct = t.liveSummary.total ? Math.round((t.liveSummary.completed / t.liveSummary.total) * 100) : 0

  return (
    <div className="space-y-6">
      <Card className="py-5">
        <CardHeader className="px-5">
          <CardTitle>Settings to test</CardTitle>
          <CardDescription>
            Server: <span className="font-medium text-foreground">{serverHost}</span> (from Settings). Changes here
            are only for this test and aren&apos;t saved. Fixtures assume today is {today}; a test can take up to{" "}
            {timeoutSeconds}s.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mt-model" help="modeltest.model">Model</Label>
              <Input
                id="mt-model"
                value={t.model}
                onChange={(e) => t.setModel(e.target.value)}
                placeholder={savedModel || "Saved model"}
                disabled={t.running}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-temp" help="modeltest.temperature">Temperature</Label>
              <Input
                id="mt-temp"
                type="number"
                step="0.1"
                min={0}
                max={2}
                value={t.temperature}
                onChange={(e) => t.setTemperature(e.target.value)}
                placeholder="Provider default"
                disabled={t.running}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-rounds" help="modeltest.rounds">Lookup rounds</Label>
              <Input
                id="mt-rounds"
                type="number"
                min={3}
                max={12}
                value={t.rounds}
                onChange={(e) => t.setRounds(e.target.value)}
                placeholder={`Default (${defaultRounds})`}
                disabled={t.running}
              />
              <p className="text-xs text-muted-foreground">Used by the “Whole conversation” tests.</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mt-extra" help="modeltest.extra-body">Extra request JSON</Label>
              <Textarea
                id="mt-extra"
                rows={3}
                className="font-mono text-xs"
                value={t.extraBody}
                onChange={(e) => t.setExtraBody(e.target.value)}
                placeholder='{"chat_template_kwargs": {"enable_thinking": true}}'
                disabled={t.running}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Presets:</span>
                {EXTRA_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="underline hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    disabled={t.running}
                    onClick={() => t.applyPreset(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  className="underline hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  disabled={t.running}
                  onClick={t.resetToSaved}
                >
                  Reset to saved
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardHeader className="px-5">
          <CardTitle className="flex items-center gap-2">
            Which tests
            <FieldHelp id="modeltest.stages" />
          </CardTitle>
          <CardDescription>
            Everything runs by default. Untick a stage or pick topics to run just those. Repeat a run to check how consistent the answers are.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {stages.map((stage) => {
              const count = catalog.filter((c) => c.stage === stage.id && t.inTopics(c)).length
              return (
                <label
                  key={stage.id}
                  className="flex items-start gap-2 rounded-lg border border-border/60 p-3 text-sm has-[:disabled]:opacity-60"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={t.selectedStages.has(stage.id)}
                    onChange={() => t.toggleStage(stage.id)}
                    disabled={t.running}
                  />
                  <span>
                    <span className="block font-medium">
                      {stage.label} <span className="font-normal text-muted-foreground">({count})</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">{stage.description}</span>
                  </span>
                </label>
              )
            })}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium" id="mt-topics-label">Topics</p>
              <FieldHelp id="modeltest.topics" />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="mt-topics-label">
              <TopicChip
                label="All topics"
                count={catalog.filter((c) => t.selectedStages.has(c.stage)).length}
                pressed={t.selectedTopics.size === 0}
                disabled={t.running}
                onClick={t.clearTopics}
              />
              {t.topics.map((topic) => (
                <TopicChip
                  key={topic}
                  label={topic}
                  count={catalog.filter((c) => c.category === topic && t.selectedStages.has(c.stage)).length}
                  pressed={t.selectedTopics.has(topic)}
                  disabled={t.running}
                  onClick={() => t.toggleTopic(topic)}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Pick one or more to run only those; pick “All topics” to go back to everything.</p>
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="mt-repeat" className="text-sm" help="modeltest.repeat">
              Repeat
            </Label>
            <Select value={String(t.repeat)} onValueChange={(v) => v && t.setRepeat(Number(v))} disabled={t.running}>
              <SelectTrigger id="mt-repeat" size="sm" className="w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPEAT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Run each test this many times to check consistency.</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {t.running ? (
          <Button type="button" size="lg" variant="destructive" onClick={t.stop}>
            Stop
          </Button>
        ) : (
          <Button type="button" size="lg" onClick={() => t.run()} disabled={!t.selectedCatalog.length}>
            {t.selectedCatalog.length === catalog.length ? "Run all tests" : `Run ${t.selectedCatalog.length} test${t.selectedCatalog.length === 1 ? "" : "s"}`}
          </Button>
        )}
        {t.canRerunFailed && (
          <Button type="button" variant="outline" onClick={t.rerunFailed}>
            Re-run failed
          </Button>
        )}
      </div>

      {t.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{t.error}</p>
      )}

      {started && (
        <Card className="py-5">
          <CardContent className="space-y-3 px-5">
            {t.startLine && <p className="text-sm text-muted-foreground">{t.startLine}</p>}
            {t.warmup && (
              <p className="text-sm">
                {t.warmup.status === "pending" && <span className="text-muted-foreground">Waking up the model…</span>}
                {t.warmup.status === "ok" && (
                  <span className="text-muted-foreground">Model ready in {formatSeconds(t.warmup.ms)}.</span>
                )}
                {t.warmup.status === "warn" && (
                  <span className="text-amber-600 dark:text-amber-400">
                    The model didn&apos;t answer the wake-up check{t.warmup.error ? `: ${t.warmup.error}` : "."}
                  </span>
                )}
              </p>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span>
                  {t.liveSummary.completed} of {t.liveSummary.total}
                </span>
                <span className="text-muted-foreground">{progressPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-green-600 dark:text-green-400">✓ {t.liveSummary.passed} passed</span>
              <span className="text-destructive">✗ {t.liveSummary.failed} failed</span>
              <span className="text-muted-foreground">
                Score:{" "}
                {t.liveSummary.completed
                  ? `${Math.round((t.liveSummary.passed / t.liveSummary.completed) * 100)}%`
                  : "—"}
              </span>
              <span className="text-muted-foreground">Elapsed: {formatSeconds(t.liveSummary.elapsedMs)}</span>
              <span className="text-muted-foreground">Avg/test: {formatSeconds(t.liveSummary.avgMs)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="py-5">
        <CardHeader className="px-5">
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <ResultsList catalog={t.selectedCatalog} stages={stages} repeat={t.repeat} results={t.results} />
        </CardContent>
      </Card>

      <RunHistory history={t.history} stages={stages} onUseSettings={t.useHistorySettings} onClear={t.clearHistory} />
    </div>
  )
}

function TopicChip(props: { label: string; count: number; pressed: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-60",
        props.pressed ? "border-primary bg-primary text-primary-foreground" : "border-border/60 hover:bg-muted"
      )}
    >
      {props.label} <span className={props.pressed ? "opacity-80" : "text-muted-foreground"}>({props.count})</span>
    </button>
  )
}
