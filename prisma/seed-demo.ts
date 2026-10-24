/**
 * Demo data seeder — wipes the database and rebuilds it with a realistic,
 * lived-in dataset for screenshots. With --keep it wipes nothing and adds the
 * demo data beside what's already there.
 *
 * Every date is written relative to the moment you run it, so re-running months
 * from now refreshes the whole timeline: overdue stays overdue, "due soon"
 * stays soon, and recent service stays recent.
 *
 *   npx tsx prisma/seed-demo.ts             # prompts before wiping
 *   npx tsx prisma/seed-demo.ts --yes       # no prompt (CI / scripted use)
 *   npx tsx prisma/seed-demo.ts --no-images # skip photo downloads
 *   npx tsx prisma/seed-demo.ts --keep      # add the demo data, delete nothing, keep your login
 *
 * See DEMO-DATA.md.
 */
import { PrismaClient, type EquipmentCategory, type PropertyType } from "../app/generated/prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import bcrypt from "bcryptjs"
import { mkdir, writeFile, readFile, rm } from "fs/promises"
import { existsSync } from "fs"
import { createInterface } from "readline"
import path from "path"
import zlib from "zlib"
import { firstCalendarDue, parseDueMonths } from "../lib/maintenance-schedule"

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db"
const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url }) })

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads"
const MANAGED_DIRS = ["properties", "vehicles", "equipment", "people", "service", "warranty", "maintenance", "condition", "insurance"]

const ADMIN_EMAIL = process.env.DEMO_EMAIL ?? "demo@homecenter.local"
const ADMIN_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234"
const ADMIN_NAME = process.env.DEMO_NAME ?? "Alex Rivera"

const args = new Set(process.argv.slice(2))
const SKIP_PROMPT = args.has("--yes") || args.has("-y")
const SKIP_IMAGES = args.has("--no-images")
/** Add the demo data beside what exists: no confirmation, no wipe, existing login kept. */
const KEEP = args.has("--keep")
const REFRESH_PHOTOS = args.has("--refresh-photos")

// Downloaded photos are cached outside the uploads folder so re-seeding is fast
// and works offline. Wikimedia throttles anonymous traffic hard enough that the
// first run takes a couple of minutes; every run after that is instant.
const PHOTO_CACHE = process.env.DEMO_PHOTO_CACHE ?? "prisma/.demo-photos"

const DAY = 86_400_000
const START = Date.now()
/** Days from now — negative is the past. */
const at = (days: number, hour = 10) => {
  const d = new Date(START + days * DAY)
  d.setHours(hour, (Math.abs(days) * 7) % 60, 0, 0)
  return d
}

// ─── Confirmation ────────────────────────────────────────────────────────────

async function confirmWipe() {
  const counts = {
    users: await prisma.user.count(),
    properties: await prisma.property.count(),
    vehicles: await prisma.vehicle.count(),
    equipment: await prisma.equipment.count(),
    serviceRecords: await prisma.serviceRecord.count(),
    warranties: await prisma.warranty.count(),
    maintenance: await prisma.maintenanceSchedule.count(),
    attachments: await prisma.attachment.count(),
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  console.log("\n\x1b[1m\x1b[31m  WARNING — THIS WIPES THE ENTIRE DATABASE\x1b[0m\n")
  console.log(`  Database:   ${url}`)
  console.log(`  Uploads:    ${path.resolve(UPLOAD_DIR)}`)
  console.log("\n  Every row below is deleted and replaced with demo data.")
  console.log("  All uploaded files are deleted. User accounts are deleted, including yours.\n")
  for (const [name, n] of Object.entries(counts)) {
    console.log(`    ${name.padEnd(16)} ${String(n).padStart(5)}`)
  }
  console.log(`    ${"total rows".padEnd(16)} ${String(total).padStart(5)}\n`)

  if (SKIP_PROMPT) {
    console.log("  --yes given, continuing without prompting.\n")
    return
  }

  if (!process.stdin.isTTY) {
    console.error("  Refusing to wipe: not an interactive terminal. Re-run with --yes if you mean it.\n")
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) =>
    rl.question("  Type WIPE to continue, anything else to abort: ", resolve)
  )
  rl.close()

  if (answer.trim() !== "WIPE") {
    console.log("\n  Aborted. Nothing was changed.\n")
    process.exit(0)
  }
  console.log()
}

async function wipe() {
  // Children first — attachments and notifications hold the foreign keys.
  await prisma.attachment.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.serviceRecord.deleteMany()
  await prisma.warranty.deleteMany()
  await prisma.maintenanceSchedule.deleteMany()
  await prisma.medication.deleteMany()
  await prisma.healthCondition.deleteMany()
  await prisma.allergy.deleteMany()
  await prisma.immunization.deleteMany()
  await prisma.insurancePolicy.deleteMany()
  await prisma.person.deleteMany()
  await prisma.provider.deleteMany()
  await prisma.equipment.deleteMany()
  await prisma.vehicle.deleteMany()
  await prisma.property.deleteMany()
  await prisma.user.deleteMany()

  for (const dir of MANAGED_DIRS) {
    await rm(path.join(UPLOAD_DIR, dir), { recursive: true, force: true })
  }
}

// ─── Images ──────────────────────────────────────────────────────────────────

/** Solid-ish PNG used when a download fails, so the demo still has artwork. */
function fallbackPng(size: number, hue: number) {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    const a = 0.55 * 0.45
    return Math.round(255 * (0.55 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))))
  }
  const [r, g, b] = [f(0), f(8), f(4)]

  const raw = Buffer.alloc(size * (size * 3 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0
    for (let x = 0; x < size; x++) {
      const band = (x + y) % 40 < 20 ? 1 : 0.82
      raw[o++] = Math.round(r * band)
      raw[o++] = Math.round(g * band)
      raw[o++] = Math.round(b * band)
    }
  }

  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  const crc32 = (buf: Buffer) => {
    let c = -1
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "ascii"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

type PhotoJob = {
  kind: "properties" | "vehicles" | "equipment"
  id: string
  /** Wikimedia Commons search query. */
  query: string
  /** Broader query tried when the specific one finds nothing usable. */
  fallbackQuery: string
  /** Distinguishes items sharing a query so two water heaters aren't identical. */
  variant: number
}

let downloaded = 0
let generated = 0

// Wikimedia Commons: no API key, searchable by subject, and the files are
// unwatermarked. (loremflickr was the obvious alternative, but its tag matching
// is loose enough to return a building for "car", and it burns an attribution
// stamp into every image — both fatal for screenshots.)
const COMMONS_API = "https://commons.wikimedia.org/w/api.php"
const USER_AGENT = "HomeCenter-demo-seed/1.0 (local development seed script)"
const NON_PHOTO = /\b(plan|blueprint|diagram|drawing|map|patent|sketch|logo|seal|icon|chart|schematic|poster|stamp|coat[_ ]of[_ ]arms)\b/i

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Wikimedia rate-limits anonymous callers on both the API and the file host.
// Every request — search and download alike — goes through one gate with a gap
// and 429 retries. Running these in parallel gets most of them throttled, and a
// throttled download looks like a tiny file rather than an error, so it silently
// degrades into a pile of placeholder images.
const REQUEST_GAP_MS = 800
let lastRequestAt = 0

async function wikimediaFetch(url: string, attempt = 0): Promise<Response | null> {
  const wait = lastRequestAt + REQUEST_GAP_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  })

  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after"))
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt)
    return wikimediaFetch(url, attempt + 1)
  }
  return res.ok ? res : null
}

async function commonsCandidates(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: "10",
    prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: "900", format: "json",
  })
  try {
    const res = await wikimediaFetch(`${COMMONS_API}?${params}`)
    if (!res) return []
    const json = (await res.json()) as {
      query?: {
        pages?: Record<string, {
          title?: string
          imageinfo?: { thumburl?: string; mime?: string; width?: number }[]
        }>
      }
    }
    return Object.values(json.query?.pages ?? {})
      // Commons is full of plans, diagrams, maps and patent drawings that match
      // these queries perfectly well and look nothing like a photo.
      .filter((page) => !NON_PHOTO.test(page.title ?? ""))
      .map((page) => page.imageinfo?.[0])
      .filter((info): info is { thumburl: string; mime: string; width: number } =>
        !!info?.thumburl && info.mime === "image/jpeg" && (info.width ?? 0) >= 640
      )
      .map((info) => info.thumburl)
  } catch {
    return []
  }
}

async function download(url: string) {
  try {
    const res = await wikimediaFetch(url)
    if (!res) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.length > 5000 ? bytes : null
  } catch {
    return null
  }
}

const cachePath = (job: PhotoJob) =>
  path.join(PHOTO_CACHE, `${job.query.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${job.variant}.jpg`)

let cached = 0

async function photoFor(job: PhotoJob): Promise<{ filename: string; bytes: Buffer }> {
  const cacheFile = cachePath(job)

  if (!REFRESH_PHOTOS && existsSync(cacheFile)) {
    cached++
    return { filename: "photo.jpg", bytes: await readFile(cacheFile) }
  }

  if (!SKIP_IMAGES) {
    for (const query of [job.query, job.fallbackQuery]) {
      const urls = await commonsCandidates(query)
      // Start at the variant offset so repeated subjects get different photos.
      for (let i = 0; i < urls.length; i++) {
        const bytes = await download(urls[(job.variant + i) % urls.length])
        if (bytes) {
          await mkdir(PHOTO_CACHE, { recursive: true })
          await writeFile(cacheFile, bytes)
          downloaded++
          return { filename: "photo.jpg", bytes }
        }
      }
    }
  }

  generated++
  return { filename: "photo.png", bytes: fallbackPng(96, (job.variant * 47) % 360) }
}

async function writePhotos(jobs: PhotoJob[]) {
  const results = new Map<string, string>()

  for (const [i, job] of jobs.entries()) {
    const { filename, bytes } = await photoFor(job)
    const dir = path.join(UPLOAD_DIR, job.kind, job.id)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, filename), bytes)
    results.set(job.id, filename)
    if ((i + 1) % 10 === 0) console.log(`    ${i + 1}/${jobs.length} (${cached} cached, ${downloaded} fetched, ${generated} generated)`)
  }

  return results
}

// ─── Attachments (small generated PDFs, so records look documented) ──────────

/// One text page per entry: the first line is a heading, the rest are body lines.
function pdfPages(pages: string[][]) {
  const contents = pages.map(
    (lines) =>
      "BT /F1 14 Tf 60 720 Td (" +
      lines[0].replace(/[()\\]/g, "") +
      ") Tj /F1 10 Tf 0 -28 Td " +
      lines
        .slice(1)
        .map((l) => `(${l.replace(/[()\\]/g, "")}) Tj 0 -16 Td `)
        .join("") +
      "ET"
  )

  // 1 catalog, 2 page tree, 3 font, then a page and its content stream per page.
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${kids}]/Count ${pages.length}>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ...contents.flatMap((content, i) => [
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>/Contents ${5 + i * 2} 0 R>>`,
      `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    ]),
  ]

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, "latin1")
}

const receiptPdf = (lines: string[]) => pdfPages([lines])

async function attach(
  recordType: "SERVICE" | "WARRANTY" | "MAINTENANCE",
  recordId: string,
  userId: string,
  originalName: string,
  lines: string[]
) {
  const bytes = receiptPdf(lines)
  const filename = `${recordType.toLowerCase()}-${recordId.slice(-6)}.pdf`
  const dir = path.join(UPLOAD_DIR, recordType.toLowerCase(), recordId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), bytes)

  await prisma.attachment.create({
    data: {
      recordType,
      filename,
      originalName,
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      uploadedById: userId,
      serviceRecordId: recordType === "SERVICE" ? recordId : null,
      warrantyId: recordType === "WARRANTY" ? recordId : null,
      maintenanceScheduleId: recordType === "MAINTENANCE" ? recordId : null,
    },
  })
}

// ─── The dataset ─────────────────────────────────────────────────────────────

const PROPERTIES: {
  name: string; type: PropertyType; address: string; sqFt: number | null
  yearBuilt: number | null; boughtDaysAgo: number; price: number; notes: string; photo: string
}[] = [
  {
    name: "Maple Street House", type: "HOUSE", address: "412 Maple St, Springfield, IL 62704",
    sqFt: 2400, yearBuilt: 1998, boughtDaysAgo: 2540, price: 342000, photo: "single family house exterior",
    notes: "Primary residence. Roof replaced 2021 (30-yr architectural shingle). Original windows on the north side are due for replacement.",
  },
  {
    name: "Lake Cabin", type: "HOUSE", address: "88 Shoreline Rd, Lake Geneva, WI 53147",
    sqFt: 1150, yearBuilt: 1975, boughtDaysAgo: 1290, price: 268000, photo: "log cabin lake",
    notes: "Seasonal. Water is shut off and lines blown out every November — see the winterizing reminder.",
  },
  {
    name: "Cedar Street Rental", type: "TOWNHOUSE", address: "155 Cedar St Unit B, Peoria, IL 61602",
    sqFt: 1320, yearBuilt: 1962, boughtDaysAgo: 810, price: 158000, photo: "brick townhouse",
    notes: "Tenant-occupied, lease renews each June. Landlord covers HVAC and appliance repairs.",
  },
]

const VEHICLES: {
  name: string; make: string; model: string; year: number; color: string; vin: string
  mileage: number; boughtDaysAgo: number; notes: string; photo: string
}[] = [
  { name: "Daily Driver", make: "Toyota", model: "RAV4 XLE", year: 2019, color: "Silver", vin: "JTMRFREV8KJ012845", mileage: 62400, boughtDaysAgo: 1870, notes: "Commuter car. Winter tires stored in the garage rafters.", photo: "Toyota RAV4" },
  { name: "Commuter", make: "Honda", model: "Civic Sport", year: 2021, color: "Blue", vin: "2HGFE2F52MH512087", mileage: 28900, boughtDaysAgo: 1130, notes: "Still under powertrain warranty.", photo: "Honda Civic" },
  { name: "Work Truck", make: "Ford", model: "F-150 XLT", year: 2017, color: "White", vin: "1FTEW1EP7HFA24193", mileage: 96300, boughtDaysAgo: 1520, notes: "Tows the boat. Brake controller installed 2022.", photo: "Ford F-150" },
  { name: "Cabin Car", make: "Subaru", model: "Outback", year: 2014, color: "Green", vin: "4S4BRBCC4E3271108", mileage: 138700, boughtDaysAgo: 980, notes: "Lives at the lake most of the year.", photo: "Subaru Outback" },
  { name: "Family Van", make: "Honda", model: "Odyssey EX-L", year: 2020, color: "Gray", vin: "5FNRL6H73LB033921", mileage: 51200, boughtDaysAgo: 1420, notes: "Third row removed for hauling.", photo: "Honda Odyssey" },
]

const EQUIPMENT: {
  house: number; name: string; category: EquipmentCategory; manufacturer: string; model: string
  location: string; installedDaysAgo: number; price: number | null; photo: string; notes?: string
  life?: number; replace?: number; valueClass?: "FIXTURE" | "CONTENTS"
}[] = [
  // ── Maple Street House ──
  { house: 0, name: "Kitchen Refrigerator", category: "APPLIANCE", manufacturer: "LG", model: "LRFVS3006S", location: "Kitchen", installedDaysAgo: 640, price: 2499, photo: "refrigerator kitchen", life: 13, replace: 2700 },
  { house: 0, name: "Dishwasher", category: "APPLIANCE", manufacturer: "Bosch", model: "SHPM88Z75N", location: "Kitchen", installedDaysAgo: 1180, price: 1049, photo: "dishwasher", life: 10, valueClass: "FIXTURE" },
  { house: 0, name: "Gas Range", category: "APPLIANCE", manufacturer: "GE", model: "JGB735SPSS", location: "Kitchen", installedDaysAgo: 1180, price: 899, photo: "gas stove kitchen" },
  { house: 0, name: "Over-Range Microwave", category: "APPLIANCE", manufacturer: "Panasonic", model: "NN-SN67KS", location: "Kitchen", installedDaysAgo: 420, price: 289, photo: "microwave oven" },
  { house: 0, name: "Washing Machine", category: "APPLIANCE", manufacturer: "Whirlpool", model: "WFW5620HW", location: "Laundry Room", installedDaysAgo: 1460, price: 799, photo: "washing machine top load" },
  { house: 0, name: "Clothes Dryer", category: "APPLIANCE", manufacturer: "Whirlpool", model: "WED5620HW", location: "Laundry Room", installedDaysAgo: 1460, price: 749, photo: "clothes dryer" },
  { house: 0, name: "Gas Furnace", category: "HVAC", manufacturer: "Carrier", model: "59SC5A100", location: "Basement", installedDaysAgo: 2190, price: 4200, photo: "gas furnace", notes: "96% AFUE. Filter is 16x25x4 — takes the thick media filter, not the cheap ones.", life: 18, replace: 5200 },
  { house: 0, name: "Central Air Conditioner", category: "HVAC", manufacturer: "Trane", model: "XR16", location: "Side Yard", installedDaysAgo: 2190, price: 5100, photo: "air conditioner condenser unit", life: 15, replace: 6500 },
  { house: 0, name: "Whole-House Humidifier", category: "HVAC", manufacturer: "Aprilaire", model: "700M", location: "Basement", installedDaysAgo: 1830, price: 320, photo: "humidifier", life: 5, replace: 450 },
  { house: 0, name: "Water Heater", category: "WATER", manufacturer: "Rheem", model: "XE50T10H45U0", location: "Basement", installedDaysAgo: 1290, price: 1450, photo: "water heater tank", life: 12, replace: 1800 },
  { house: 0, name: "Water Softener", category: "WATER", manufacturer: "Culligan", model: "HE 1.25", location: "Basement", installedDaysAgo: 980, price: 1890, photo: "water softener" },
  { house: 0, name: "Sump Pump", category: "WATER", manufacturer: "Zoeller", model: "M53", location: "Basement", installedDaysAgo: 730, price: 240, photo: "sump pump", notes: "Battery backup was added at the same time — battery is the part that ages out." },
  { house: 0, name: "Garage Door Opener", category: "SECURITY", manufacturer: "Chamberlain", model: "B4643T", location: "Garage", installedDaysAgo: 560, price: 329, photo: "garage door opener" },
  { house: 0, name: "Doorbell Camera", category: "SECURITY", manufacturer: "Ring", model: "Pro 2", location: "Front Porch", installedDaysAgo: 410, price: 249, photo: "video doorbell" },

  // ── Lake Cabin ──
  { house: 1, name: "Cabin Refrigerator", category: "APPLIANCE", manufacturer: "Frigidaire", model: "FFTR1835VS", location: "Kitchen", installedDaysAgo: 1150, price: 749, photo: "refrigerator" },
  { house: 1, name: "Propane Range", category: "APPLIANCE", manufacturer: "Unique", model: "UGP-24V", location: "Kitchen", installedDaysAgo: 1150, price: 1299, photo: "propane stove" },
  { house: 1, name: "Wood Stove", category: "HVAC", manufacturer: "Jøtul", model: "F 602 V2", location: "Living Room", installedDaysAgo: 1290, price: 1850, photo: "wood burning stove", notes: "Chimney needs sweeping every season before first use." },
  { house: 1, name: "Mini-Split Heat Pump", category: "HVAC", manufacturer: "Mitsubishi", model: "MSZ-FH12NA", location: "Main Room", installedDaysAgo: 870, price: 3400, photo: "ductless mini split air conditioner" },
  { house: 1, name: "Well Pump", category: "WATER", manufacturer: "Goulds", model: "10GS05", location: "Well House", installedDaysAgo: 1620, price: 1240, photo: "water well pump" },
  { house: 1, name: "Cabin Water Heater", category: "WATER", manufacturer: "Bradford White", model: "RG240T6N", location: "Utility Closet", installedDaysAgo: 1620, price: 980, photo: "water heater tank" },
  { house: 1, name: "Dock Lift", category: "OUTDOOR", manufacturer: "ShoreStation", model: "SSV30108", location: "Dock", installedDaysAgo: 1290, price: 6800, photo: "boat lift dock" },
  { house: 1, name: "Standby Generator", category: "OUTDOOR", manufacturer: "Generac", model: "Guardian 18kW", location: "Side Yard", installedDaysAgo: 690, price: 5600, photo: "standby generator" },
  { house: 1, name: "Chainsaw", category: "TOOL", manufacturer: "Stihl", model: "MS 271 Farm Boss", location: "Shed", installedDaysAgo: 1450, price: 449, photo: "chainsaw" },

  // ── Cedar Street Rental ──
  { house: 2, name: "Rental Refrigerator", category: "APPLIANCE", manufacturer: "GE", model: "GTS18GTHWW", location: "Kitchen", installedDaysAgo: 760, price: 699, photo: "refrigerator white" },
  { house: 2, name: "Rental Range", category: "APPLIANCE", manufacturer: "Hotpoint", model: "RBS360DMWW", location: "Kitchen", installedDaysAgo: 760, price: 549, photo: "electric stove" },
  { house: 2, name: "Rental Washer", category: "APPLIANCE", manufacturer: "Maytag", model: "MVWC565FW", location: "Basement", installedDaysAgo: 520, price: 679, photo: "washing machine top load" },
  { house: 2, name: "Rental Dryer", category: "APPLIANCE", manufacturer: "Maytag", model: "MEDC465HW", location: "Basement", installedDaysAgo: 520, price: 629, photo: "clothes dryer laundry room" },
  { house: 2, name: "Boiler", category: "HVAC", manufacturer: "Weil-McLain", model: "CGa-4-PIDN", location: "Basement", installedDaysAgo: 2920, price: 3900, photo: "boiler heating", notes: "Cast iron, original to the 1990s remodel. Annual service is not optional at this age.", life: 25, replace: 7800 },
  { house: 2, name: "Rental Water Heater", category: "WATER", manufacturer: "A. O. Smith", model: "GCR-40", location: "Basement", installedDaysAgo: 1980, price: 890, photo: "water heater basement", life: 10, replace: 1500 },
  { house: 2, name: "Smoke & CO Alarms", category: "SECURITY", manufacturer: "First Alert", model: "SC9120B", location: "Hallways", installedDaysAgo: 760, price: 180, photo: "smoke detector" },
]

type Ref = { kind: "property" | "vehicle" | "equipment"; index: number }
const P = (i: number): Ref => ({ kind: "property", index: i })
const V = (i: number): Ref => ({ kind: "vehicle", index: i })
const E = (i: number): Ref => ({ kind: "equipment", index: i })

const SERVICE: {
  ref: Ref; daysAgo: number; title: string; vendor: string | null; cost: number | null
  description?: string; mileage?: number; receipt?: string
}[] = [
  // Recent — these fill the dashboard's "Recent Service" panel
  { ref: E(6), daysAgo: 4, title: "Annual furnace service", vendor: "Springfield Heating & Air", cost: 189, description: "Cleaned burners, checked heat exchanger, replaced 16x25x4 media filter. Inducer motor showing early bearing noise — flagged for next season.", receipt: "furnace-service-invoice.pdf" },
  { ref: V(0), daysAgo: 9, title: "Oil change & tire rotation", vendor: "Jiffy Lube", cost: 82.4, mileage: 62180, description: "0W-20 full synthetic. Rear brakes at 5mm." },
  { ref: E(11), daysAgo: 12, title: "Sump pump backup battery replaced", vendor: "DIY", cost: 164.99, description: "Original battery was five years old and failing the self-test." },
  { ref: E(0), daysAgo: 18, title: "Ice maker repair", vendor: "Appliance Medics", cost: 245, description: "Replaced water inlet valve. Part under manufacturer warranty, labor billed.", receipt: "icemaker-repair.pdf" },
  { ref: V(2), daysAgo: 23, title: "Brake pads & rotors — front", vendor: "Midas", cost: 612.35, mileage: 95980, receipt: "brake-invoice.pdf" },
  { ref: P(0), daysAgo: 27, title: "Gutter cleaning", vendor: "Top Notch Exteriors", cost: 225 },
  { ref: E(28), daysAgo: 31, title: "Boiler annual inspection", vendor: "Peoria Mechanical", cost: 210, description: "Combustion test passed. Recommended replacing the expansion tank within two years." },

  // Last few months
  { ref: V(1), daysAgo: 44, title: "Oil change", vendor: "Honda of Springfield", cost: 74.2, mileage: 27600 },
  { ref: E(9), daysAgo: 52, title: "Water heater flush", vendor: "DIY", cost: 0, description: "Drained about four gallons of sediment. Anode rod still has life." },
  { ref: P(1), daysAgo: 61, title: "Dock removal for the season", vendor: "Lakeside Marine", cost: 480 },
  { ref: E(21), daysAgo: 66, title: "Generator load bank test", vendor: "Generac Authorized Service", cost: 295, receipt: "generator-service.pdf" },
  { ref: E(16), daysAgo: 74, title: "Chimney sweep & inspection", vendor: "Ashes Chimney Service", cost: 260, description: "Level 1 inspection, no creosote glazing. Cap screen replaced." },
  { ref: V(4), daysAgo: 88, title: "Transmission fluid service", vendor: "Honda of Springfield", cost: 268.5, mileage: 49900 },
  { ref: E(4), daysAgo: 96, title: "Washer drain pump replaced", vendor: "Appliance Medics", cost: 318, description: "Sock in the pump housing. Again." },
  { ref: V(3), daysAgo: 112, title: "Head gasket replacement", vendor: "Lakeside Auto", cost: 2340, mileage: 136400, description: "Known EJ25 issue. Resurfaced heads, new timing belt and water pump while it was apart.", receipt: "head-gasket-invoice.pdf" },
  { ref: E(7), daysAgo: 128, title: "AC condenser coil cleaning", vendor: "Springfield Heating & Air", cost: 145 },
  { ref: P(2), daysAgo: 140, title: "Tenant turnover — paint & carpet", vendor: "Cedar Property Services", cost: 2180, receipt: "turnover-invoice.pdf" },
  { ref: E(10), daysAgo: 155, title: "Softener resin bed replaced", vendor: "Culligan", cost: 640 },

  // Older history
  { ref: V(0), daysAgo: 178, title: "Oil change & cabin filter", vendor: "Jiffy Lube", cost: 96.8, mileage: 57400 },
  { ref: E(18), daysAgo: 192, title: "Well pump pressure switch", vendor: "Geneva Well & Pump", cost: 385 },
  { ref: P(0), daysAgo: 205, title: "Driveway sealcoating", vendor: "Blacktop Brothers", cost: 540 },
  { ref: E(6), daysAgo: 218, title: "Furnace igniter replaced", vendor: "Springfield Heating & Air", cost: 232, description: "No-heat call on the coldest night of the year, naturally." },
  { ref: V(2), daysAgo: 236, title: "Oil change", vendor: "Quick Lane", cost: 89.95, mileage: 91200 },
  { ref: E(24), daysAgo: 250, title: "Rental range element replaced", vendor: "Cedar Property Services", cost: 145 },
  { ref: V(1), daysAgo: 268, title: "Tires — set of four", vendor: "Discount Tire", cost: 812.6, mileage: 24100, receipt: "tire-invoice.pdf" },
  { ref: E(17), daysAgo: 288, title: "Mini-split deep clean", vendor: "Northwoods HVAC", cost: 340, description: "Blower wheel was fully loaded with mold. Big improvement in airflow." },
  { ref: P(1), daysAgo: 310, title: "Winterizing — water lines blown out", vendor: "Geneva Well & Pump", cost: 195 },
  { ref: E(2), daysAgo: 340, title: "Range igniter replaced", vendor: "DIY", cost: 42.5 },
  { ref: V(4), daysAgo: 366, title: "Oil change & alignment", vendor: "Honda of Springfield", cost: 214.3, mileage: 44800 },
  { ref: E(29), daysAgo: 392, title: "Water heater T&P valve replaced", vendor: "Peoria Mechanical", cost: 165 },
  { ref: P(0), daysAgo: 430, title: "Tree removal — dead ash", vendor: "Arbor Care", cost: 1450, receipt: "tree-removal.pdf" },
  { ref: V(3), daysAgo: 468, title: "Oil change", vendor: "Lakeside Auto", cost: 78.5, mileage: 131900 },
  { ref: E(12), daysAgo: 505, title: "Garage door spring replacement", vendor: "Overhead Door Co.", cost: 289 },
  { ref: E(1), daysAgo: 548, title: "Dishwasher not draining", vendor: "Appliance Medics", cost: 198, description: "Check valve replaced." },
  { ref: V(0), daysAgo: 590, title: "Brake fluid flush", vendor: "Toyota of Springfield", cost: 149, mileage: 51200 },
  { ref: P(2), daysAgo: 640, title: "Roof repair — wind damage", vendor: "Peoria Roofing", cost: 1875, receipt: "roof-repair.pdf" },
  { ref: E(20), daysAgo: 700, title: "Dock lift motor rebuild", vendor: "Lakeside Marine", cost: 720 },
  { ref: E(26), daysAgo: 760, title: "Rental washer installed", vendor: "Cedar Property Services", cost: 0, description: "Replaced the previous unit after the tenant reported leaking." },
]

const WARRANTIES: {
  ref: Ref; productName: string; vendor: string; phone?: string; email?: string
  boughtDaysAgo: number; expiresInDays: number | null; notes?: string; receipt?: string
}[] = [
  // Expired
  { ref: E(3), productName: "Microwave — 1 year limited", vendor: "Panasonic", boughtDaysAgo: 420, expiresInDays: -55, phone: "800-211-7262" },
  { ref: E(13), productName: "Doorbell camera — 1 year", vendor: "Ring", boughtDaysAgo: 410, expiresInDays: -45, email: "support@ring.com" },
  { ref: V(3), productName: "Powertrain — 5 yr / 60k", vendor: "Subaru of America", boughtDaysAgo: 980, expiresInDays: -190 },

  // Expiring soon — these drive the dashboard panel
  { ref: E(0), productName: "Refrigerator — sealed system", vendor: "LG Electronics", boughtDaysAgo: 640, expiresInDays: 18, phone: "800-243-0000", notes: "Sealed system only. Compressor is covered 10 years, everything else has run out.", receipt: "lg-warranty.pdf" },
  { ref: E(21), productName: "Standby generator — 5 yr limited", vendor: "Generac", boughtDaysAgo: 690, expiresInDays: 34, phone: "888-436-3722" },
  { ref: E(12), productName: "Garage door opener — parts", vendor: "Chamberlain", boughtDaysAgo: 560, expiresInDays: 52 },

  // Comfortably active
  { ref: E(9), productName: "Water heater tank — 6 year", vendor: "Rheem", boughtDaysAgo: 1290, expiresInDays: 900, phone: "800-621-5622", receipt: "rheem-warranty.pdf" },
  { ref: E(6), productName: "Furnace heat exchanger — 20 year", vendor: "Carrier", boughtDaysAgo: 2190, expiresInDays: 5110, notes: "Registered within 90 days, which is what kept the 20-year term." },
  { ref: E(7), productName: "AC compressor — 10 year", vendor: "Trane", boughtDaysAgo: 2190, expiresInDays: 1460 },
  { ref: E(17), productName: "Mini-split — 12 yr compressor", vendor: "Mitsubishi Electric", boughtDaysAgo: 870, expiresInDays: 3510 },
  { ref: E(10), productName: "Water softener — 5 yr parts", vendor: "Culligan", boughtDaysAgo: 980, expiresInDays: 845 },
  { ref: V(1), productName: "Powertrain — 5 yr / 60k", vendor: "American Honda", boughtDaysAgo: 1130, expiresInDays: 695 },
  { ref: V(4), productName: "Powertrain — 5 yr / 60k", vendor: "American Honda", boughtDaysAgo: 1420, expiresInDays: 405 },
  { ref: E(20), productName: "Dock lift — structural", vendor: "ShoreStation", boughtDaysAgo: 1290, expiresInDays: 1360 },
  { ref: P(0), productName: "Roof — 30 yr architectural shingle", vendor: "GAF / Top Notch Exteriors", boughtDaysAgo: 1620, expiresInDays: 9330, receipt: "gaf-roof-warranty.pdf" },
  { ref: E(24), productName: "Rental range — 1 yr parts & labor", vendor: "Hotpoint", boughtDaysAgo: 760, expiresInDays: null, notes: "Paperwork never came back from the installer — treat as uncovered." },
]

const MAINTENANCE: {
  ref: Ref; title: string; description?: string; intervalDays: number | null; dueInDays: number | null
  intervalMiles?: number; dueInMiles?: number; reminderDaysBefore?: number
  estimatedCost?: number; dueMonths?: string; dueDay?: number
  /** Page of the demo furnace manual this reminder points at. */
  manualPage?: number
}[] = [
  // Overdue
  { ref: E(8), title: "Replace humidifier water panel", description: "Aprilaire #35 panel. Takes ten minutes.", intervalDays: 365, dueInDays: -21, estimatedCost: 24 },
  { ref: E(23), title: "Rental smoke alarm battery check", intervalDays: 182, dueInDays: -9, reminderDaysBefore: 14 },
  { ref: V(2), title: "Oil change", intervalDays: 180, dueInDays: -4, intervalMiles: 7500, dueInMiles: 500 },

  // Due soon
  { ref: E(6), title: "Replace furnace filter", description: "16x25x4 media filter — the thick one.", intervalDays: 90, dueInDays: 6, reminderDaysBefore: 14, estimatedCost: 38, manualPage: 3 },
  { ref: P(0), title: "Winterize sprinklers", description: "Blow out the lines before the first hard freeze.", intervalDays: null, dueInDays: null, dueMonths: "10", dueDay: 15, estimatedCost: 85 },
  { ref: P(0), title: "Replace roof", description: "Shingles are rated for 30 years. Get quotes two years out.", intervalDays: null, dueInDays: 1095, estimatedCost: 14000 },
  { ref: E(11), title: "Test sump pump", description: "Pour a bucket into the pit and confirm it kicks on.", intervalDays: 90, dueInDays: 11 },
  { ref: P(1), title: "Winterize cabin — blow out water lines", description: "Before first hard freeze. Geneva Well & Pump does it, book two weeks ahead.", intervalDays: 365, dueInDays: 19, reminderDaysBefore: 30 },
  { ref: E(16), title: "Chimney sweep", intervalDays: 365, dueInDays: 24, reminderDaysBefore: 30 },
  { ref: V(0), title: "Oil change", intervalDays: 180, dueInDays: 27, intervalMiles: 7500, dueInMiles: 4900, estimatedCost: 89 },

  // Comfortably ahead
  { ref: E(10), title: "Refill softener salt", intervalDays: 60, dueInDays: 38 },
  { ref: E(9), title: "Flush water heater", intervalDays: 365, dueInDays: 52 },
  { ref: P(0), title: "Clean gutters", description: "Twice a year — spring and after the leaves drop.", intervalDays: 182, dueInDays: 61 },
  { ref: E(21), title: "Generator oil & filter", intervalDays: 365, dueInDays: 74, reminderDaysBefore: 21 },
  { ref: E(7), title: "AC service before summer", intervalDays: 365, dueInDays: 96 },
  { ref: V(1), title: "Oil change", intervalDays: 180, dueInDays: 104, intervalMiles: 7500, dueInMiles: 6100 },
  { ref: E(28), title: "Boiler annual service", description: "Non-negotiable at this age.", intervalDays: 365, dueInDays: 118, reminderDaysBefore: 30 },
  { ref: E(18), title: "Well water test", description: "Coliform and nitrate panel.", intervalDays: 365, dueInDays: 132 },
  { ref: P(2), title: "HVAC filter — rental", intervalDays: 90, dueInDays: 41 },
  { ref: E(5), title: "Clean dryer vent duct", description: "Full duct to the exterior hood, not just the lint trap.", intervalDays: 365, dueInDays: 147 },
  { ref: V(4), title: "Tire rotation", intervalDays: 180, dueInDays: 158, intervalMiles: 7500, dueInMiles: 5200 },
  { ref: E(19), title: "Cabin water heater anode check", intervalDays: 730, dueInDays: 186 },
  { ref: E(20), title: "Dock lift cable inspection", intervalDays: 365, dueInDays: 205 },
  { ref: E(22), title: "Sharpen chainsaw chain", intervalDays: 180, dueInDays: 74 },
  { ref: V(3), title: "Timing belt — 105k interval", intervalDays: null, dueInDays: null, intervalMiles: 105000, dueInMiles: 3200, estimatedCost: 900 },
  { ref: E(1), title: "Clean dishwasher filter", intervalDays: 90, dueInDays: 33 },
]

// ─── People ──────────────────────────────────────────────────────────────────

type VisitSeed = {
  personId: string
  providerId: string | null
  conditionId: string | null
  vendor: string
  days: number
  title: string
  category: "OFFICE_VISIT" | "DENTAL" | "PRESCRIPTION"
  cost: number
}

/**
 * Home, auto, life and umbrella policies, so every non-health kind shows: coverage lines, premium history
 * (yearly, every 6 months, monthly), renewals inside and outside the 30-day window, one policy covering
 * nothing yet, and one covering people (visible only with Health on). They show with Health off too.
 */
async function seedInsurance(properties: { id: string }[], vehicles: { id: string }[]) {
  await prisma.insurancePolicy.create({
    data: {
      carrier: "State Farm", planName: "Homeowners HO-3", kind: "HOME", policyNumber: "HO-4471-208",
      startDate: at(-344), endDate: at(21), deductible: 2500,
      properties: { connect: [{ id: properties[0].id }] },
      coverages: {
        create: [
          { label: "Dwelling", limit: 450000, sortOrder: 0 },
          { label: "Other structures", limit: 45000, sortOrder: 1 },
          { label: "Personal property", limit: 225000, sortOrder: 2 },
          { label: "Loss of use", limit: 90000, sortOrder: 3 },
          { label: "Liability", limit: 300000, sortOrder: 4 },
          { label: "Medical payments", limit: 5000, sortOrder: 5 },
        ],
      },
      premiums: {
        create: [
          { effectiveDate: at(-709), amount: 1560, period: "ANNUAL" },
          { effectiveDate: at(-344), amount: 1740, period: "ANNUAL" },
        ],
      },
    },
  })
  await prisma.insurancePolicy.create({
    data: {
      carrier: "Progressive", planName: "Auto", kind: "AUTO", startDate: at(-40), endDate: at(142),
      vehicles: { connect: [{ id: vehicles[2].id }] },
      coverages: {
        create: [
          { label: "Bodily injury", limit: 100000, sortOrder: 0 },
          { label: "Property damage", limit: 50000, sortOrder: 1 },
          { label: "Collision", deductible: 1000, sortOrder: 2 },
          { label: "Comprehensive", deductible: 500, sortOrder: 3 },
          { label: "Uninsured motorist", limit: 100000, sortOrder: 4 },
        ],
      },
      premiums: {
        create: [
          { effectiveDate: at(-222), amount: 672, period: "SEMIANNUAL" },
          { effectiveDate: at(-40), amount: 708, period: "SEMIANNUAL" },
        ],
      },
    },
  })
  // Renewing in 18 days (a second renewal notice), linked to nothing, monthly premium unchanged.
  await prisma.insurancePolicy.create({
    data: {
      carrier: "Chubb", planName: "Personal umbrella", kind: "UMBRELLA", policyNumber: "UMB-90311",
      startDate: at(-347), endDate: at(18),
      coverages: { create: [{ label: "Liability", limit: 1000000, sortOrder: 0 }] },
      premiums: { create: [{ effectiveDate: at(-347), amount: 33.33, period: "MONTHLY" }] },
    },
  })
  // Covers the people, so it shows their names only with Health on. Ends well outside the 30-day window.
  const people = await prisma.person.findMany({ select: { id: true } })
  await prisma.insurancePolicy.create({
    data: {
      carrier: "Lifeco", planName: "20-year term", kind: "LIFE", policyNumber: "TL-77210",
      startDate: at(-900), endDate: at(5000),
      members: { connect: people.map((x) => ({ id: x.id })) },
      coverages: { create: [{ label: "Death benefit", limit: 500000, sortOrder: 0 }] },
      premiums: {
        create: [
          { effectiveDate: at(-900), amount: 41, period: "MONTHLY" },
          { effectiveDate: at(-170), amount: 45, period: "MONTHLY" },
        ],
      },
    },
  })
}

async function seedPeople(userId: string) {
  const drChen = await prisma.provider.create({ data: { name: "Dr. Maria Chen", specialty: "Family medicine", practice: "Riverside Family Health", phone: "555-201-4410" } })
  const drPatel = await prisma.provider.create({ data: { name: "Dr. Anil Patel", specialty: "Dentistry", practice: "Bright Smile Dental", phone: "555-201-8832" } })
  const drOkafor = await prisma.provider.create({ data: { name: "Dr. Grace Okafor", specialty: "Pediatrics", practice: "Riverside Family Health", phone: "555-201-4411" } })

  const adult = await prisma.person.create({ data: { name: ADMIN_NAME, relationship: "SELF", dateOfBirth: new Date("1984-03-12"), bloodType: "O+", primaryProviderId: drChen.id } })
  const child = await prisma.person.create({ data: { name: "Sam Rivera", relationship: "CHILD", dateOfBirth: new Date("2016-08-30"), primaryProviderId: drOkafor.id } })

  const hypertension = await prisma.healthCondition.create({ data: { personId: adult.id, name: "Hypertension", status: "MANAGED", diagnosedDate: at(-900), providerId: drChen.id } })
  await prisma.healthCondition.create({ data: { personId: child.id, name: "Seasonal asthma", status: "ACTIVE", diagnosedDate: at(-500), providerId: drOkafor.id } })

  await prisma.medication.create({ data: { personId: adult.id, name: "Lisinopril", dosage: "10 mg", frequency: "Once daily", prescriberId: drChen.id, conditionId: hypertension.id, startDate: at(-890), refillIntervalDays: 30, nextRefillDate: at(4), pharmacy: "Walgreens on Main" } })
  await prisma.medication.create({ data: { personId: child.id, name: "Amoxicillin", dosage: "250 mg", frequency: "Three times daily", prescriberId: drOkafor.id, startDate: at(-200), endDate: at(-190) } })

  await prisma.allergy.create({ data: { personId: child.id, substance: "Penicillin", severity: "SEVERE", reaction: "Hives, facial swelling" } })
  await prisma.allergy.create({ data: { personId: adult.id, substance: "Pollen", severity: "MILD", reaction: "Sneezing" } })

  await prisma.immunization.create({ data: { personId: adult.id, vaccine: "Tdap", dateGiven: at(-3400), nextDueDate: at(250) } })
  await prisma.immunization.create({ data: { personId: child.id, vaccine: "Influenza", dateGiven: at(-340), nextDueDate: at(20) } })

  const both = { connect: [{ id: adult.id }, { id: child.id }] }
  await prisma.insurancePolicy.create({ data: { carrier: "Blue Cross", planName: "PPO Family", kind: "MEDICAL", memberId: "XJH448201", groupNumber: "77120", phone: "800-555-0199", startDate: at(-600), endDate: at(45), deductible: 3000, outOfPocketMax: 8000, members: both } })
  await prisma.insurancePolicy.create({ data: { carrier: "Delta Dental", kind: "DENTAL", memberId: "DD-5521", startDate: at(-600), members: both } })

  const visits: VisitSeed[] = [
    { personId: adult.id, providerId: drChen.id, conditionId: hypertension.id, vendor: drChen.name, days: -60, title: "Blood pressure follow-up", category: "OFFICE_VISIT", cost: 45 },
    { personId: adult.id, providerId: drChen.id, conditionId: null, vendor: drChen.name, days: -200, title: "Annual physical", category: "OFFICE_VISIT", cost: 0 },
    { personId: adult.id, providerId: drPatel.id, conditionId: null, vendor: drPatel.name, days: -120, title: "Dental cleaning", category: "DENTAL", cost: 85 },
    { personId: child.id, providerId: drOkafor.id, conditionId: null, vendor: drOkafor.name, days: -195, title: "Ear infection", category: "OFFICE_VISIT", cost: 35 },
    { personId: child.id, providerId: null, conditionId: null, vendor: "Walgreens on Main", days: -194, title: "Amoxicillin prescription", category: "PRESCRIPTION", cost: 12.5 },
  ]
  for (const v of visits) {
    const record = await prisma.serviceRecord.create({
      data: {
        assetType: "PERSON", assetId: v.personId, date: at(v.days), title: v.title, category: v.category,
        cost: v.cost, vendor: v.vendor, providerId: v.providerId, conditionId: v.conditionId, createdById: userId,
      },
    })
    await attach("SERVICE", record.id, userId, `${v.title}.pdf`, [v.title, v.vendor, `Amount due: $${v.cost.toFixed(2)}`])
  }

  await prisma.maintenanceSchedule.create({ data: { assetType: "PERSON", assetId: adult.id, title: "Annual physical", intervalDays: 365, nextDueDate: at(165) } })
  await prisma.maintenanceSchedule.create({ data: { assetType: "PERSON", assetId: child.id, title: "Dental cleaning", intervalDays: 180, nextDueDate: at(10) } })
}

// ─── Seed ────────────────────────────────────────────────────────────────────

async function main() {
  let user: { id: string }
  if (KEEP) {
    console.log("\n  --keep given: nothing is deleted. Adding demo data beside what's already here.\n")
    // Records need an author: use an existing admin, else any user, else create the demo login.
    const existing = (await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } })) ?? (await prisma.user.findFirst())
    user = existing ?? (await prisma.user.create({
      data: { name: ADMIN_NAME, email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12), role: "ADMIN", mustResetPassword: false },
    }))
  } else {
    await confirmWipe()

    console.log("  Wiping…")
    await wipe()

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12)
    user = await prisma.user.create({
      data: { name: ADMIN_NAME, email: ADMIN_EMAIL, passwordHash, role: "ADMIN", mustResetPassword: false },
    })
  }

  console.log("  Creating assets…")
  const properties: { id: string }[] = []
  for (const p of PROPERTIES) {
    properties.push(
      await prisma.property.create({
        data: {
          name: p.name, type: p.type, address: p.address, sqFt: p.sqFt, yearBuilt: p.yearBuilt,
          purchaseDate: at(-p.boughtDaysAgo), purchasePrice: p.price, notes: p.notes,
        },
      })
    )
  }

  const vehicles: { id: string; currentMileage: number | null }[] = []
  for (const v of VEHICLES) {
    vehicles.push(
      await prisma.vehicle.create({
        data: {
          name: v.name, make: v.make, model: v.model, year: v.year, color: v.color, vin: v.vin,
          currentMileage: v.mileage, purchaseDate: at(-v.boughtDaysAgo), notes: v.notes,
        },
      })
    )
  }

  const equipment: { id: string }[] = []
  for (const e of EQUIPMENT) {
    equipment.push(
      await prisma.equipment.create({
        data: {
          name: e.name, category: e.category, manufacturer: e.manufacturer, modelNumber: e.model,
          serialNumber: `${e.manufacturer.slice(0, 3).toUpperCase()}-${String(100000 + equipment.length * 7331).slice(0, 6)}`,
          location: e.location, propertyId: properties[e.house].id,
          purchaseDate: at(-e.installedDaysAgo - 3), installDate: at(-e.installedDaysAgo),
          purchasePrice: e.price, notes: e.notes ?? null,
          expectedLifeYears: e.life ?? null, replacementCost: e.replace ?? null, valueClass: e.valueClass ?? null,
        },
      })
    )
  }

  const resolve = (ref: Ref) =>
    ref.kind === "property"
      ? { assetId: properties[ref.index].id, assetType: "PROPERTY" as const }
      : ref.kind === "vehicle"
        ? { assetId: vehicles[ref.index].id, assetType: "VEHICLE" as const }
        : { assetId: equipment[ref.index].id, assetType: "EQUIPMENT" as const }

  console.log("  Creating history…")
  for (const s of SERVICE) {
    const record = await prisma.serviceRecord.create({
      data: {
        ...resolve(s.ref), date: at(-s.daysAgo), title: s.title, description: s.description ?? null,
        vendor: s.vendor, cost: s.cost, mileageAtService: s.mileage ?? null, createdById: user.id,
      },
    })
    if (s.receipt) {
      await attach("SERVICE", record.id, user.id, s.receipt, [
        "SERVICE INVOICE",
        `Work: ${s.title}`,
        `Vendor: ${s.vendor ?? "—"}`,
        `Date: ${at(-s.daysAgo).toLocaleDateString()}`,
        `Total: $${(s.cost ?? 0).toFixed(2)}`,
        "",
        "Demo document generated by seed-demo.ts",
      ])
    }
  }

  for (const w of WARRANTIES) {
    const warranty = await prisma.warranty.create({
      data: {
        ...resolve(w.ref), productName: w.productName, vendor: w.vendor,
        vendorPhone: w.phone ?? null, vendorEmail: w.email ?? null,
        purchaseDate: at(-w.boughtDaysAgo),
        expirationDate: w.expiresInDays === null ? null : at(w.expiresInDays),
        notes: w.notes ?? null,
      },
    })
    if (w.receipt) {
      await attach("WARRANTY", warranty.id, user.id, w.receipt, [
        "WARRANTY CERTIFICATE",
        `Coverage: ${w.productName}`,
        `Provider: ${w.vendor}`,
        `Purchased: ${at(-w.boughtDaysAgo).toLocaleDateString()}`,
        `Expires: ${w.expiresInDays === null ? "—" : at(w.expiresInDays).toLocaleDateString()}`,
        "",
        "Demo document generated by seed-demo.ts",
      ])
    }
  }

  // A 3-page owner's manual filed on the Gas Furnace, so "Replace furnace filter" can point at page 3.
  const furnace = resolve(E(6))
  const manualBytes = pdfPages([
    ["Carrier 59SC5A owner's manual", "Page 1: Safety", "Read all warnings before servicing the furnace."],
    ["Thermostat settings", "Page 2: Thermostat settings", "Set the fan to auto for normal heating."],
    ["Replacing the air filter", "Page 3: Replacing the air filter", "Use a 16x25x4 media filter.", "Turn the power off, slide the old filter out, and slide the new one in with the arrow toward the furnace."],
  ])
  const manualFilename = "furnace-manual.pdf"
  const manualDir = path.join(UPLOAD_DIR, "document", furnace.assetId)
  await mkdir(manualDir, { recursive: true })
  await writeFile(path.join(manualDir, manualFilename), manualBytes)
  const manual = await prisma.attachment.create({
    data: {
      recordType: "DOCUMENT",
      filename: manualFilename,
      originalName: "Carrier 59SC5A owner's manual.pdf",
      mimeType: "application/pdf",
      sizeBytes: manualBytes.length,
      uploadedById: user.id,
      assetType: furnace.assetType,
      assetId: furnace.assetId,
    },
  })

  for (const m of MAINTENANCE) {
    const asset = resolve(m.ref)
    const vehicle = m.ref.kind === "vehicle" ? vehicles[m.ref.index] : null
    await prisma.maintenanceSchedule.create({
      data: {
        ...asset, title: m.title, description: m.description ?? null,
        intervalDays: m.intervalDays, intervalMiles: m.intervalMiles ?? null,
        estimatedCost: m.estimatedCost ?? null,
        referenceAttachmentId: m.manualPage ? manual.id : null,
        referencePage: m.manualPage ?? null,
        dueMonths: m.dueMonths ?? null,
        dueDay: m.dueMonths ? m.dueDay ?? 1 : null,
        nextDueDate: m.dueMonths
          ? firstCalendarDue(parseDueMonths(m.dueMonths), m.dueDay ?? 1, new Date())
          : m.dueInDays === null ? null : at(m.dueInDays),
        nextDueMileage: m.dueInMiles != null && vehicle?.currentMileage != null
          ? vehicle.currentMileage + m.dueInMiles
          : null,
        lastCompletedDate: m.dueInDays !== null && m.intervalDays !== null
          ? at(m.dueInDays - m.intervalDays)
          : null,
        lastCompletedMileage: m.intervalMiles != null && m.dueInMiles != null && vehicle?.currentMileage != null
          ? vehicle.currentMileage + m.dueInMiles - m.intervalMiles
          : null,
        reminderDaysBefore: m.reminderDaysBefore ?? 14,
        isActive: true,
      },
    })
  }

  console.log(SKIP_IMAGES ? "  Generating placeholder images…" : "  Downloading photos…")
  const categoryFallback: Record<EquipmentCategory, string> = {
    APPLIANCE: "home appliance", HVAC: "heating ventilation air conditioning", WATER: "plumbing",
    ELECTRONICS: "consumer electronics", TOOL: "power tool", OUTDOOR: "garden equipment",
    SECURITY: "home security", OTHER: "hardware",
  }

  console.log("  Creating people…")
  await seedPeople(user.id)

  console.log("  Creating insurance…")
  await seedInsurance(properties, vehicles)

  const jobs: PhotoJob[] = [
    ...properties.map((p, i) => ({ kind: "properties" as const, id: p.id, query: PROPERTIES[i].photo, fallbackQuery: "house exterior", variant: i })),
    ...vehicles.map((v, i) => ({ kind: "vehicles" as const, id: v.id, query: VEHICLES[i].photo, fallbackQuery: "automobile", variant: i })),
    ...equipment.map((e, i) => ({ kind: "equipment" as const, id: e.id, query: EQUIPMENT[i].photo, fallbackQuery: categoryFallback[EQUIPMENT[i].category], variant: i })),
  ]
  const photos = await writePhotos(jobs)

  for (const p of properties) await prisma.property.update({ where: { id: p.id }, data: { imageFilename: photos.get(p.id) } })
  for (const v of vehicles) await prisma.vehicle.update({ where: { id: v.id }, data: { imageFilename: photos.get(v.id) } })
  for (const e of equipment) await prisma.equipment.update({ where: { id: e.id }, data: { imageFilename: photos.get(e.id) } })

  const overdue = await prisma.maintenanceSchedule.count({ where: { isActive: true, nextDueDate: { lt: new Date() } } })
  const dueSoon = await prisma.maintenanceSchedule.count({
    where: { isActive: true, nextDueDate: { gte: new Date(), lte: at(30) } },
  })
  const expiring = await prisma.warranty.count({ where: { expirationDate: { gte: new Date(), lte: at(60) } } })
  const expired = await prisma.warranty.count({ where: { expirationDate: { lt: new Date() } } })

  console.log(`
  \x1b[32mDone.\x1b[0m

    ${properties.length} properties, ${vehicles.length} vehicles, ${equipment.length} equipment
    ${SERVICE.length} service records, ${WARRANTIES.length} warranties, ${MAINTENANCE.length} reminders
    ${await prisma.attachment.count()} attachments
    ${await prisma.person.count()} people, ${await prisma.provider.count()} providers, ${await prisma.insurancePolicy.count()} insurance policies (${await prisma.insurancePolicy.count({ where: { kind: { notIn: ["MEDICAL", "DENTAL", "VISION", "OTHER"] } } })} home or auto)
    photos: ${cached} cached, ${downloaded} fetched, ${generated} generated

  Timeline (relative to today):
    ${overdue} maintenance overdue, ${dueSoon} due within 30 days
    ${expired} warranties expired, ${expiring} expiring within 60 days

  ${KEEP ? "Sign in with your existing login (nothing was deleted)." : `Sign in:  ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`}
`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
