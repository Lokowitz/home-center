import { headers } from "next/headers"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Home } from "lucide-react"
import { clientIp } from "@/lib/login-throttle"
import { RESET_TOKEN_MINUTES, requestPasswordReset } from "@/lib/password-reset"
import { passwordResetAvailable, requestDeps } from "@/lib/password-reset-server"

async function request(formData: FormData) {
  "use server"
  const result = await requestPasswordReset(formData.get("email"), clientIp(await headers()), requestDeps)
  redirect(`/forgot-password?status=${result}`)
}

const MESSAGES: Record<string, { text: string; ok?: boolean }> = {
  sent: {
    text: `If that email belongs to an account, a reset link is on its way. It works once and expires in ${RESET_TOKEN_MINUTES} minutes.`,
    ok: true,
  },
  throttled: { text: "Too many reset requests. Wait an hour, then try again." },
  invalid: { text: "Enter a valid email address." },
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  // No mail server, no reset: send people back to sign in.
  if (!(await passwordResetAvailable())) redirect("/login")
  const message = status ? MESSAGES[status] : undefined

  return (
    <div className="min-h-svh flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Home className="h-5 w-5" />
          </div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">HomeCenter</h1>
          <p className="text-sm text-muted-foreground">Reset your password</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Forgot your password?</CardTitle>
            <CardDescription className={message ? (message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive") : undefined}>
              {message?.text ?? "Enter your email and we'll send you a link to choose a new one."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form action={request} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" help="auth.reset-email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              <Button type="submit" className="w-full">Email me a reset link</Button>
            </form>
            <Link href="/login" className="block text-center text-sm text-muted-foreground hover:underline">Back to sign in</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
