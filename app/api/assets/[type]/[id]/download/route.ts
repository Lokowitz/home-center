import { auth } from "@/auth"
import { NextRequest, NextResponse } from "next/server"
import { zipSync, strToU8 } from "fflate"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { parseAssetSegment } from "@/lib/report-server"
import { resolveUploadPath } from "@/lib/upload-path"
import { loadFeatures } from "@/lib/features-server"
import { collectAssetFiles } from "@/lib/asset-files-server"

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

  const files: Record<string, Uint8Array> = {}

  // Two attachments can land on the same zip path (e.g. same title, same
  // filename) — number the later ones instead of letting them overwrite.
  function uniquePath(zipPath: string): string {
    if (!(zipPath in files)) return zipPath
    const ext = path.extname(zipPath)
    const base = zipPath.slice(0, zipPath.length - ext.length)
    let n = 2
    let candidate = `${base} (${n})${ext}`
    while (candidate in files) {
      n++
      candidate = `${base} (${n})${ext}`
    }
    return candidate
  }

  for (const { zipPath, segments } of await collectAssetFiles(assetType, id)) {
    const filePath = resolveUploadPath(...segments)
    if (existsSync(filePath)) files[uniquePath(zipPath)] = new Uint8Array(readFileSync(filePath))
  }

  if (Object.keys(files).length === 0) {
    files["README.txt"] = strToU8("No attachments found for this asset.")
  }

  const zipped = zipSync(files, { level: 6 })

  return new NextResponse(zipped, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="homecenter-${type}-${id}.zip"`,
    },
  })
}
