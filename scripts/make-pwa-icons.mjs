// One-off: builds the PWA icons in public/icons from the 256px image inside
// app/favicon.ico. Re-run after changing the favicon.
import { readFileSync } from "node:fs"
import sharp from "sharp"

const ico = readFileSync("app/favicon.ico")
let png
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const entry = 6 + i * 16
  const start = ico.readUInt32LE(entry + 12)
  const data = ico.subarray(start, start + ico.readUInt32LE(entry + 8))
  if (data.subarray(1, 4).toString() === "PNG" && (!png || data.length > png.length)) png = data
}
if (!png) throw new Error("no PNG image in app/favicon.ico")

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }
// iOS fills transparency with black, so every icon sits on white. `inset` is the
// share of each edge left empty; maskable icons need a larger safe zone.
const out = [
  ["app-192.png", 192, 0.1],
  ["app-512.png", 512, 0.1],
  ["app-maskable-512.png", 512, 0.2],
  ["apple-touch-icon.png", 180, 0.1],
]
for (const [name, size, inset] of out) {
  const inner = Math.round(size * (1 - inset * 2))
  const glyph = await sharp(png).resize(inner, inner, { kernel: "lanczos3" }).png().toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: glyph, gravity: "centre" }])
    .png()
    .toFile(`public/icons/${name}`)
}
