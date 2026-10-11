// Engine file: pure.
export type Tone = "ok" | "stale" | "failed" | "none"

export function statusTone(i: { newestAt: Date | null; lastStatus: string | null; stale: boolean }): Tone {
  if (i.lastStatus === "FAILED" || i.lastStatus === "INTERRUPTED") return "failed"
  if (!i.newestAt) return i.stale ? "stale" : "none"
  if (i.stale || i.lastStatus === "WARN") return "stale"
  return "ok"
}
