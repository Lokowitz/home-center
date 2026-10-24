"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from "@/components/ui/form"
import { updateMailSettings, sendTestEmail, testMailConnection } from "@/lib/actions/mail-settings"
import type { MailFieldSource } from "@/lib/notifications/mail-config"

type Sources = Record<string, MailFieldSource>

const SECURE_LABELS: Record<string, string> = {
  auto: "Automatic (TLS on port 465)",
  true: "Always use TLS",
  false: "Never use TLS",
}

/** Says where a value came from, so an env-provided default isn't a mystery. */
function SourceNote({ source }: { source: MailFieldSource }) {
  if (source === "env") return <FormDescription className="text-xs">From an environment variable.</FormDescription>
  if (source === "default") return <FormDescription className="text-xs">Using the default.</FormDescription>
  return null
}

export function MailSettings({
  initial,
  sources,
  hasStoredPassword,
  passwordUnreadable,
  configured,
  dryRun,
}: {
  initial: { host: string; port: string; username: string; secure: string; fromAddress: string; digestHour: string; publicUrl: string }
  sources: Sources
  hasStoredPassword: boolean
  passwordUnreadable: boolean
  configured: boolean
  dryRun: boolean
}) {
  const form = useForm({ defaultValues: { ...initial, password: "" } })
  const [clearPassword, setClearPassword] = useState(false)
  const [testing, startTest] = useTransition()

  async function onSubmit(values: typeof initial & { password: string }) {
    const result = await updateMailSettings({
      ...values,
      secure: values.secure as "auto" | "true" | "false",
      clearPassword,
    })
    if (result?.error) {
      toast.error(result.error)
      return
    }
    toast.success("Mail settings saved.")
    form.setValue("password", "")
    setClearPassword(false)
  }

  function runTest(kind: "connection" | "email") {
    startTest(async () => {
      // Send what's typed, so a setting can be tried before it's committed.
      const values = form.getValues()
      const draft = {
        ...values,
        secure: values.secure as "auto" | "true" | "false",
        clearPassword,
      }
      const result = kind === "connection" ? await testMailConnection(draft) : await sendTestEmail(draft)
      if ("error" in result && result.error) {
        // pre-line so the guidance appended to a provider's raw reply keeps its
        // paragraph break instead of running together.
        toast.error(result.error, { duration: 15000, style: { whiteSpace: "pre-line" } })
        return
      }
      if (kind === "connection") toast.success("Connected to the mail server.")
      else {
        const sent = result as { sentTo?: string; dryRun?: boolean }
        toast.success(
          sent.dryRun
            ? "Dry run — logged instead of sent (MAIL_DRY_RUN is on)."
            : `Test email sent to ${sent.sentTo}.`
        )
      }
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Mail server
          {configured ? <Badge variant="secondary">Configured</Badge> : <Badge variant="outline">Not configured</Badge>}
          {dryRun && <Badge variant="outline">Dry run</Badge>}
        </CardTitle>
        <CardDescription>
          Used to email reminders. Anything set here overrides the matching <code className="text-xs">SMTP_*</code>{" "}
          environment variable; clear a field to fall back to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {passwordUnreadable && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            The saved password can&apos;t be decrypted — this happens if <code className="text-xs">AUTH_SECRET</code>{" "}
            changed. Enter it again to fix mail delivery.
          </p>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="host" render={({ field }) => (
                <FormItem>
                  <FormLabel help="mail.host">Server</FormLabel>
                  <FormControl><Input placeholder="smtp.gmail.com" {...field} /></FormControl>
                  <SourceNote source={sources.host} />
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="port" render={({ field }) => (
                <FormItem>
                  <FormLabel help="mail.port">Port</FormLabel>
                  <FormControl><Input type="number" placeholder="587" {...field} /></FormControl>
                  <SourceNote source={sources.port} />
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="username" render={({ field }) => (
                <FormItem>
                  <FormLabel help="mail.username">Username</FormLabel>
                  <FormControl><Input placeholder="you@gmail.com" {...field} /></FormControl>
                  <FormDescription className="text-xs">Leave blank for an unauthenticated relay.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel help="mail.password">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={hasStoredPassword ? "•••••••• (unchanged)" : ""}
                      disabled={clearPassword}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Stored encrypted. With Gmail or iCloud use an app password.
                    {hasStoredPassword && (
                      <button
                        type="button"
                        className="ml-1 underline hover:text-foreground"
                        onClick={() => setClearPassword((c) => !c)}
                      >
                        {clearPassword ? "Keep saved password" : "Remove saved password"}
                      </button>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="secure" render={({ field }) => (
                <FormItem>
                  <FormLabel help="mail.secure">Encryption</FormLabel>
                  <Select value={field.value} onValueChange={(v) => field.onChange(v ?? field.value)}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>{(v: string) => SECURE_LABELS[v] ?? v}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(SECURE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="digestHour" render={({ field }) => (
                <FormItem>
                  <FormLabel help="mail.digest-hour">Digest hour</FormLabel>
                  <FormControl><Input type="number" min={0} max={23} placeholder="8" {...field} /></FormControl>
                  <FormDescription className="text-xs">When daily and weekly emails go out.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="fromAddress" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="mail.from">From address</FormLabel>
                  <FormControl><Input placeholder="HomeCenter <no-reply@homecenter.local>" {...field} /></FormControl>
                  <FormDescription className="text-xs">
                    Many providers require this to match the account you signed in with.
                  </FormDescription>
                  <SourceNote source={sources.from} />
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="publicUrl" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel help="mail.public-url">Public address</FormLabel>
                  <FormControl><Input placeholder="https://home.example.com" {...field} /></FormControl>
                  <FormDescription className="text-xs">
                    Where links in emails point, such as password reset. Use the address people type in their browser.
                  </FormDescription>
                  <SourceNote source={sources.publicUrl} />
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" disabled={testing} onClick={() => runTest("connection")}>
                Test connection
              </Button>
              <Button type="button" variant="outline" disabled={testing} onClick={() => runTest("email")}>
                Send test email
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tests use what&apos;s typed above, so you can try settings before saving. An empty
              password field falls back to the saved one.
            </p>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
