import { describe, expect, it } from "vitest"
import { initialsOf } from "./asset-visuals"

describe("initialsOf", () => {
  it("takes the first letters of the first and last word", () => {
    expect(initialsOf("Maple Street House")).toBe("MH")
    expect(initialsOf("lake cabin")).toBe("LC")
  })

  it("takes two letters of a single word, and a placeholder for an empty name", () => {
    expect(initialsOf("Truck")).toBe("TR")
    expect(initialsOf("   ")).toBe("?")
  })

  // An emoji is two UTF-16 units. Cutting it in half renders as U+FFFD on the
  // server and a lone surrogate on the client, which breaks hydration.
  it("never splits an emoji", () => {
    expect(initialsOf("QA place 🏠")).toBe("Q🏠")
    expect(initialsOf("🏠 Home")).toBe("🏠H")
    expect(initialsOf("🏠🚗🛠")).toBe("🏠🚗")
  })
})
