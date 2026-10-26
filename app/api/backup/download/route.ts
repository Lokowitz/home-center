import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { adminRoute } from "@/lib/auth-guard"
import { backupFolder, loadBackupSettings } from "@/lib/backup/settings-server"
import { listBackups } from "@/lib/backup/store"

/** The plain filename= fallback for old clients; filename* carries the real name. */
const asciiName = (n: string) => n.replace(/[^\x20-\x7e]|["\\%]/g, "_")

export async function GET(request: NextRequest) {
  const { denied } = await adminRoute()
  if (denied) return denied
  const file = request.nextUrl.searchParams.get("file") ?? ""
  // Only names the folder listing knows; never a path from the client.
  const b = (await listBackups(backupFolder(await loadBackupSettings()))).find((x) => x.file === file)
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return new NextResponse(Readable.toWeb(createReadStream(b.path)) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(b.size),
      "Content-Disposition": `attachment; filename="${asciiName(b.file)}"; filename*=UTF-8''${encodeURIComponent(b.file)}`,
    },
  })
}
