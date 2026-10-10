import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { nextUrl } = req
  const session = req.auth

  // Auth API and static assets pass through
  if (nextUrl.pathname.startsWith("/api/auth")) return NextResponse.next()

  // Container healthcheck: no session, and it only answers ok/error.
  if (nextUrl.pathname === "/api/health") return NextResponse.next()

  // Public routes
  const publicPaths = ["/login", "/setup"]
  if (publicPaths.includes(nextUrl.pathname)) {
    if (session) return NextResponse.redirect(new URL("/", req.url))
    return NextResponse.next()
  }

  // All other routes require authentication
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  // Force password change before accessing anything else
  if (session.user.mustResetPassword && nextUrl.pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.url))
  }

  return NextResponse.next()
})

// The two upload routes are left out: proxy buffers every request body it sees
// (10 MB by default, truncating anything longer), which broke uploads between
// that and MAX_UPLOAD_BYTES. Both routes check the session themselves and
// refuse an oversized body from its headers before reading it.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/|api/uploads$|api/assets/[^/]+/[^/]+/image$).*)"],
}
