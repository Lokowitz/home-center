import { auth } from "@/auth"
import { redirect } from "next/navigation"

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
