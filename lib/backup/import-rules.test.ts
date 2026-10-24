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
const helpers = ["lib/attachment-location.ts", "lib/secret-box.ts", "lib/maintenance-schedule.ts", "lib/equipment-value.ts", "lib/manual-reference.ts", "lib/insurance.ts"]

describe("engine import rule", () => {
  it.each([...engine, ...scripts, ...helpers])("%s imports no @/ at runtime", (file) => {
    const src = readFileSync(path.join(root, file), "utf8")
    const runtime = src.split("\n").filter((l) => /from\s+["']@\//.test(l) && !/^\s*import\s+type\b/.test(l))
    expect(runtime).toEqual([])
  })
})

describe("engine files outside lib/backup", () => {
  const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8")
  const reached = new Set<string>()
  for (const file of [...engine, ...scripts]) {
    const src = readFileSync(path.join(root, file), "utf8")
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])) + ".ts"
      if (!target.startsWith("lib/backup/") && !target.startsWith("scripts/")) reached.add(target)
    }
  }

  it.each([...reached])("%s is a listed helper and is copied into the Docker image", (file) => {
    expect(helpers).toContain(file)
    expect(dockerfile).toContain(`COPY --from=builder /app/${file} ./${file}`)
  })
})
