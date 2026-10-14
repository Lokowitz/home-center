import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// scripts/restore-apply.ts runs these files with tsx inside the Docker runner,
// which has no @/ app sources. Type-only imports are erased, so they are fine.
const root = path.resolve(__dirname, "../..")
const engine = readdirSync(path.join(root, "lib/backup"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith("-server.ts") && !f.endsWith(".test.ts") && f !== "test-support.ts")
  .map((f) => `lib/backup/${f}`)
const scripts = readdirSync(path.join(root, "scripts")).filter((f) => /^(backup|restore)/.test(f)).map((f) => `scripts/${f}`)
const helpers = ["lib/attachment-location.ts", "lib/secret-box.ts"]

describe("engine import rule", () => {
  it.each([...engine, ...scripts, ...helpers])("%s imports no @/ at runtime", (file) => {
    const src = readFileSync(path.join(root, file), "utf8")
    const runtime = src.split("\n").filter((l) => /from\s+["']@\//.test(l) && !/^\s*import\s+type\b/.test(l))
    expect(runtime).toEqual([])
  })
})
