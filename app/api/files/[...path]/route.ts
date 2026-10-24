import { auth } from "@/auth"
import { NextRequest, NextResponse } from "next/server"
import { readFile, stat } from "fs/promises"
import path from "path"
import { resolveUploadPath } from "@/lib/upload-path"
import { UPLOAD_TYPES } from "@/lib/upload-types"
import { loadFeatures } from "@/lib/features-server"
import { prisma } from "@/lib/prisma"
import { isHealthInsuranceKind } from "@/lib/insurance"

async function isPerson(id: string | undefined): Promise<boolean> {
  return !!id && !!(await prisma.person.findUnique({ where: { id }, select: { id: true } }))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { path: segments } = await params
  // People's photos and documents go with the rest of Health.
  if (!(await loadFeatures()).health && (segments[0] === "people" || (segments[0] === "document" && (await isPerson(segments[1]))))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  // A medical, dental or vision card is health data; home, auto and life policy files aren't.
  if (!(await loadFeatures()).health && segments[0] === "insurance") {
    const policy = await prisma.insurancePolicy.findUnique({ where: { id: segments[1] ?? "" }, select: { kind: true } })
    if (policy && isHealthInsuranceKind(policy.kind)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!(await loadFeatures()).rooms && segments[0] === "room") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  let filePath: string
  try {
    filePath = resolveUploadPath(...segments)
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!fileStat.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const mime = UPLOAD_TYPES[path.extname(filePath).toLowerCase()]
  const buffer = await readFile(filePath)

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mime ?? "application/octet-stream",
      // Anything not on the allow-list is handed over as a download, never rendered.
      "Content-Disposition": mime ? "inline" : "attachment",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  })
}
