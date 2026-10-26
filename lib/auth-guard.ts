import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { NextResponse } from "next/server"

/** For server actions and pages: sends anyone else away. */
export async function requireAdmin() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/")
  return session
}

/** For route handlers, which answer with a status instead of redirecting. */
export async function adminSession() {
  const session = await auth()
  return session?.user.role === "ADMIN" ? session : null
}

/** Like adminSession, but says why: 401 with no session, 403 for a signed-in non-admin. */
export async function adminRoute() {
  const session = await auth()
  if (!session) return { denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null }
  if (session.user.role !== "ADMIN") return { denied: NextResponse.json({ error: "Forbidden" }, { status: 403 }), session: null }
  return { denied: null, session }
}
