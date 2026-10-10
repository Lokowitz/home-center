import { describe, expect, it } from "vitest"
import { impossibleLinks, unlink, unverifiedLinks } from "./link-check"

const seen = ['{"rows":[{"id":"real1","href":"/assets/vehicles/real1"},{"id":"m1","href":"/assets/people/p1"}]}']

describe("unverifiedLinks", () => {
  it("flags internal links no tool returned this turn", () => {
    const text = "The [Work Truck](/assets/vehicles/fake9) and [Daily Driver](/assets/vehicles/real1)."
    expect(unverifiedLinks(text, seen)).toEqual(["/assets/vehicles/fake9"])
  })
  it("flags made-up page paths even when the id is real", () => {
    expect(unverifiedLinks("[Lisinopril](/assets/medications/m1)", seen)).toEqual(["/assets/medications/m1"])
  })
  it("allows the app's fixed pages and external links", () => {
    const text = "See [costs](/costs), [providers](/providers), [vehicles](/assets/vehicles) and [docs](https://x.com/a/b)."
    expect(unverifiedLinks(text, [])).toEqual([])
  })
  it("allows the Intake page", () => {
    expect(unverifiedLinks("File it from [Intake](/intake).", [])).toEqual([])
    expect(impossibleLinks(["/intake"])).toEqual([])
    expect(impossibleLinks(["/inbox"])).toEqual(["/inbox"])
  })
  it("reports each bad link once", () => {
    expect(unverifiedLinks("[a](/assets/people/x1) [b](/assets/people/x1)", [])).toEqual(["/assets/people/x1"])
  })
})

describe("impossibleLinks", () => {
  it("accepts links to uploaded files, but not made-up file paths", () => {
    expect(impossibleLinks(["/api/files/warranty/clw123/3f2a1b4c-1111-2222-3333-444455556666.pdf"])).toEqual([])
    expect(impossibleLinks(["/api/files/secrets/x/3f2a1b4c-1111-2222-3333-444455556666.pdf"])).toHaveLength(1)
    expect(impossibleLinks(["/api/files/warranty/clw123/../../etc/passwd"])).toHaveLength(1)
  })

  it("picks out paths no page in the app has", () => {
    expect(
      impossibleLinks([
        "/assets/medications/m1", "/assets/providers?eq=Springfield", "/assets/serviceRecords/s1", "/assets/providers/p1",
        "/assets/vehicles/v1", "/assets/people/p1?tab=observations&open=o1", "/providers", "/assets/vehicles",
      ])
    ).toEqual(["/assets/medications/m1", "/assets/providers?eq=Springfield", "/assets/serviceRecords/s1", "/assets/providers/p1"])
  })
})

describe("unlink", () => {
  it("keeps the label and drops the given links only", () => {
    const text = "The [Work Truck](/assets/vehicles/fake9) and [Daily Driver](/assets/vehicles/real1)."
    expect(unlink(text, ["/assets/vehicles/fake9"])).toBe("The Work Truck and [Daily Driver](/assets/vehicles/real1).")
  })
})
