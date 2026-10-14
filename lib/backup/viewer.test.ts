import { describe, expect, it } from "vitest"
import { dataJs, viewerHtml } from "./viewer"

describe("offline viewer", () => {
  it("loads nothing from the network", () => {
    const html = viewerHtml()
    expect(html).toContain('<script src="data.js"></script>')
    expect(html).not.toMatch(/(src|href)=["']https?:/)
    expect(html).not.toMatch(/@import|url\(http/)
  })
  it("data.js cannot break out of its script", () => {
    const js = dataJs({ assets: [{ name: "</script><script>alert(1)</script>" }] } as never)
    expect(js.startsWith("window.HC_DATA = ")).toBe(true)
    expect(js).not.toContain("</script>")
  })
  it("renders data with textContent only", () => {
    expect(viewerHtml()).not.toContain("innerHTML")
  })
  it("escapes markup and line separators in data.js", () => {
    const name = "<img src=x onerror=alert(1)> & \u2028 \u2029"
    const js = dataJs({ assets: [{ name }] } as never)
    expect(js).not.toMatch(/[<>&\u2028\u2029]/)
    const body = js.replace(/^window\.HC_DATA = /, "").replace(/;\n$/, "")
    expect(JSON.parse(body).assets[0].name).toBe(name)
  })
  it("has a restrictive CSP, no network URLs, and only links paths under files/", () => {
    const html = viewerHtml()
    expect(html).toMatch(/Content-Security-Policy[^>]*default-src 'none'/)
    expect(html).not.toMatch(/https?:/)
    expect(html).toContain("encodeURIComponent")
    expect(html).toContain('indexOf("../files/") !== 0')
  })
  it("safePath rejects everything but relative files/ paths and encodes each segment", () => {
    const m = /function safePath\(p\) \{[\s\S]*?\n  \}\n/.exec(viewerHtml())
    expect(m).not.toBeNull()
    const safePath = new Function(m![0] + "; return safePath")() as (p: unknown) => string | null
    for (const bad of ["javascript:alert(1)", "//evil", "https://evil/x", "../files/a/../../x", "../files/a" + String.fromCharCode(92) + "b", "../files//x", "../x", "files/a", "data:text/html,x", 5, null, undefined])
      expect(safePath(bad), String(bad)).toBeNull()
    expect(safePath("../files/..%2f")).toBe("../files/..%252f")
    expect(safePath("../files/A B/c#.pdf")).toBe("../files/A%20B/c%23.pdf")
  })
})
