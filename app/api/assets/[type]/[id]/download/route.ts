import { auth } from "@/auth"
import { createReadStream } from "node:fs"
import { rm } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { parseAssetSegment } from "@/lib/report-server"
import { loadFeatures } from "@/lib/features-server"
import { createExport } from "@/lib/backup/export"
import { dbPathFromUrl, uploadDir, workDir } from "@/lib/backup/paths"
import { appVersion } from "@/lib/backup/settings-server"
import { acquireAssetDownload, sweepOldExports } from "@/lib/backup/export-limits-server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { type, id } = await params
  const assetType = parseAssetSegment(type)
  if (!assetType) return NextResponse.json({ error: "Invalid asset type" }, { status: 400 })
  if (assetType === "PERSON" && !(await loadFeatures()).health) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const run = `asset-${randomUUID()}`
  const release = acquireAssetDownload(run)
  if (!release) return NextResponse.json({ error: "Busy building another download. Try again in a moment." }, { status: 429 })
  const outDir = path.join(workDir(), "exports", run)
  let streaming = false
  try {
    await sweepOldExports(run)
    const out = await createExport({
      dbPath: dbPathFromUrl(process.env.DATABASE_URL), uploadDir: uploadDir(), outDir, workDir: workDir(),
      appVersion: await appVersion(), scope: { kind: "asset", assetType, assetId: id },
    })
    const stream = createReadStream(out.path)
    // The zip is built for this one request; remove it once the stream ends or the client goes away.
    streaming = true
    stream.on("close", () => {
      release()
      void rm(outDir, { recursive: true, force: true }).catch(() => undefined)
    })
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="homecenter-${type}-${id.replace(/[^\w-]/g, "_")}.zip"`,
      },
    })
  } catch (e) {
    await rm(outDir, { recursive: true, force: true }).catch(() => undefined)
    console.error("[download] export failed:", e)
    return NextResponse.json({ error: "Couldn't build the download." }, { status: 500 })
  } finally {
    if (!streaming) release()
  }
}
