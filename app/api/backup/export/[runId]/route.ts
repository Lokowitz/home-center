import { createReadStream } from "node:fs"
import { rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { adminSession } from "@/lib/auth-guard"
import { exportDir } from "@/lib/backup/jobs-server"
import { safeJoin } from "@/lib/backup/paths"

const RUN_ID = /^[A-Za-z0-9_-]{8,64}$/

const asciiName = (n: string) => n.replace(/[^\x20-\x7e]|["\\%]/g, "_")

type Params = { params: Promise<{ runId: string }> }

/** The export file this admin may take, or the error response. */
async function locate(params: Params["params"]): Promise<{ dir: string; p: string; size: number; name: string } | NextResponse> {
  const session = await adminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { runId } = await params
  if (!RUN_ID.test(runId)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const run = await prisma.backupRun.findUnique({ where: { id: runId } })
  // Only the admin who made the export can take it.
  if (!run || run.kind !== "EXPORT" || run.createdById !== session.user.id || !run.file || (run.status !== "OK" && run.status !== "WARN")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const dir = exportDir(run.id)
  const p = safeJoin(dir, run.file)
  const size = p ? await stat(p).then((s) => (s.isFile() ? s.size : null), () => null) : null
  if (!p || size === null) return NextResponse.json({ error: "This export was already downloaded." }, { status: 410 })
  return { dir, p, size, name: path.basename(run.file) }
}

/** Lets the page check the download is there before navigating to it; reads nothing, deletes nothing. */
export async function HEAD(_request: NextRequest, { params }: Params) {
  const f = await locate(params)
  if (f instanceof NextResponse) return new NextResponse(null, { status: f.status })
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } })
}

export async function GET(_request: NextRequest, { params }: Params) {
  const f = await locate(params)
  if (f instanceof NextResponse) return f
  const { dir, p, size, name } = f
  const stream = createReadStream(p)
  // One download per export: the file holds everything, so it doesn't linger on disk.
  // Only a download that was read to the end deletes it; an aborted one can be retried.
  stream.on("close", () => {
    if (stream.readableEnded) void rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  })
}
