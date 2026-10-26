import { createWriteStream } from "node:fs"
import { mkdir, rm, statfs } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { NextRequest, NextResponse } from "next/server"
import { adminRoute } from "@/lib/auth-guard"
import { isJobRunning } from "@/lib/backup/jobs-server"
import { restoreDir } from "@/lib/backup/paths"
import { hasPending } from "@/lib/backup/restore"

// Excluded from proxy.ts so a multi-GB body isn't buffered or truncated; auth is checked here.
// The body streams straight to disk. The client never names the file: the id is made here.
export async function POST(request: NextRequest) {
  const { session, denied } = await adminRoute()
  if (denied) return denied
  // The proxy's forced password change doesn't run for this route, so it is repeated here.
  if (session.user.mustResetPassword) return NextResponse.json({ error: "Change your password first." }, { status: 403 })
  if (!request.body) return NextResponse.json({ error: "No file" }, { status: 400 })
  if (isJobRunning()) return NextResponse.json({ error: "Wait for the running backup or export to finish." }, { status: 409 })
  const root = restoreDir()
  if (await hasPending(root)) return NextResponse.json({ error: "A restore is already waiting for a restart." }, { status: 409 })

  const dir = path.join(root, "incoming")
  const id = randomUUID()
  const dest = path.join(dir, `${id}.upload`)
  try {
    await rm(dir, { recursive: true, force: true }) // one upload at a time
    await mkdir(dir, { recursive: true })
    // Restoring needs about twice the file's size, so refuse early when the declared size can't fit.
    const declared = Number(request.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > 0) {
      const fs = await statfs(dir)
      if (Number(fs.bavail) * Number(fs.bsize) < declared * 2) {
        return NextResponse.json({ error: "Not enough free disk space to restore a file this size (about twice its size is needed)." }, { status: 507 })
      }
    }
    await pipeline(Readable.fromWeb(request.body as never), createWriteStream(dest, { flags: "wx" }))
  } catch (e) {
    await rm(dest, { force: true }).catch(() => undefined)
    const full = (e as NodeJS.ErrnoException).code === "ENOSPC"
    return NextResponse.json(
      { error: full ? "The disk filled up during the upload." : "The upload didn't finish." },
      { status: full ? 507 : 400 },
    )
  }
  return NextResponse.json({ id })
}
