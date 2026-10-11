import { describe, expect, it, vi } from "vitest"

// The tools module reaches Prisma at import; nothing here queries it.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
import { chatTools, MODEL_TEST_TOOLS } from "../tools"
import { describeTool } from "./checks"

const names = MODEL_TEST_TOOLS.map((t) => t.name)

describe("model test tools", () => {
  it("are the chat's tools with Health on and document indexing off, in the same order", () => {
    expect(names).toEqual(chatTools({ enabled: false, includeHealth: true }).map((t) => t.name))
  })

  it("include the read-only intake tool and no document tools", () => {
    expect(names).toContain("intake")
    expect(names).not.toContain("search_documents")
  })

  it("have a plain-language description for every tool", () => {
    for (const name of names) expect(describeTool(name), name).not.toMatch(/^a lookup/)
  })
})
