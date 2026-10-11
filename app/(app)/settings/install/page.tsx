import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InstalledNotice } from "@/components/settings/installed-notice"

export default async function InstallPage() {
  const session = await auth()
  if (!session) redirect("/login")

  // Any signed-in user can open this page, but the Features tab is admin-only.
  const backHref = session.user.role === "ADMIN" ? "/settings?tab=features" : "/"

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {session.user.role === "ADMIN" ? "Back to Settings" : "Back to dashboard"}
        </Link>
        <h1 className="font-heading text-2xl font-semibold">Install HomeCenter as an app</h1>
        <p className="text-sm text-muted-foreground">
          Put HomeCenter on your Home Screen. It opens full-screen with its own icon, like any other app. Nothing is
          downloaded from an app store, and you can remove it any time.
        </p>
      </div>

      <InstalledNotice />

      <Card className="py-5">
        <CardHeader className="px-5">
          <CardTitle>iPhone and iPad</CardTitle>
          <CardDescription>Do this on the device itself, with HomeCenter open in Safari.</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Open HomeCenter in <strong>Safari</strong> and sign in.</li>
            <li>Tap the <strong>Share</strong> button (the square with an arrow pointing up) in the toolbar.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>. If you don&apos;t see it, tap <strong>View More</strong> first.</li>
            <li>Leave the name as <strong>HomeCenter</strong> and tap <strong>Add</strong>.</li>
            <li>Open HomeCenter from the new icon on your Home Screen.</li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Other iOS browsers (Chrome, Edge) can do this too from their Share menu on iOS 16.4 or later; Safari works on
            every version.
          </p>
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardHeader className="px-5">
          <CardTitle>Android and desktop Chrome or Edge</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <p className="text-sm">
            Open the browser menu and choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>).
          </p>
        </CardContent>
      </Card>

      <Card className="py-5">
        <CardHeader className="px-5">
          <CardTitle>Good to know</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-5 text-sm text-muted-foreground">
          <p>The installed app is the same site: it needs a connection and uses the same sign-in as the browser.</p>
          <p>
            Access over <strong>https</strong> works best. If you reach HomeCenter by a plain http address on your
            network, iOS still adds the icon but may open it as an ordinary browser tab.
          </p>
          <p>To remove it, press and hold the icon on the Home Screen and choose Remove App.</p>
        </CardContent>
      </Card>
    </div>
  )
}
