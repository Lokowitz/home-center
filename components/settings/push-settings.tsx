"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { FieldHelp } from "@/components/ui/field-help"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { sendTestPush, updatePushSettings } from "@/lib/actions/notification-settings"
import { PUSH_TYPES, type PushType } from "@/lib/notifications/push-format"
import { describeInterval } from "@/lib/notifications/interval"
import { Warning } from "./notification-schedule"

const URL_PLACEHOLDER: Record<PushType, string> = {
  DISCORD: "https://discord.com/api/webhooks/…",
  NTFY: "https://ntfy.sh/my-topic",
  TELEGRAM: "",
  JSON: "https://example.com/hook",
}

// Admin-only. One endpoint for the whole household, so every account that gets
// notifications is covered by the same channel.
export function PushSettings({
  initial,
  hasStoredUrl,
  hasStoredToken,
  unreadable,
  lastError,
  lastOk,
  intervalMinutes,
}: {
  initial: { enabled: boolean; type: PushType; chatId: string }
  hasStoredUrl: boolean
  hasStoredToken: boolean
  unreadable: boolean
  lastError: string | null
  /** Already formatted for display, or null if nothing was ever sent. */
  lastOk: string | null
  intervalMinutes: number
}) {
  const [enabled, setEnabled] = useState(initial.enabled)
  const [type, setType] = useState<PushType>(initial.type)
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [chatId, setChatId] = useState(initial.chatId)
  const [clearUrl, setClearUrl] = useState(false)
  const [clearToken, setClearToken] = useState(false)
  const [pending, startTransition] = useTransition()

  const telegram = type === "TELEGRAM"
  // A stored secret belongs to the service it was saved for.
  const sameType = type === initial.type
  const urlStored = hasStoredUrl && sameType && !telegram
  const tokenStored = hasStoredToken && sameType

  const draft = () => ({ enabled, type, url, token, chatId, clearUrl, clearToken })

  function save() {
    startTransition(async () => {
      const result = await updatePushSettings(draft())
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success("Push settings saved.")
      setUrl("")
      setToken("")
      setClearUrl(false)
      setClearToken(false)
    })
  }

  function test() {
    startTransition(async () => {
      const result = await sendTestPush(draft())
      if (result?.error) toast.error(result.error, { duration: 10000 })
      else toast.success("Test message sent.")
    })
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-2">
          Push notifications
          {enabled ? <Badge variant="secondary">On</Badge> : <Badge variant="outline">Off</Badge>}
        </CardTitle>
        <CardDescription>
          Sends one message to Discord, ntfy, Telegram or a webhook each time new reminders are found, for
          everyone who gets notifications. It goes out on the check schedule, so a message can arrive up to{" "}
          {describeInterval(intervalMinutes)} after a reminder is created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-5">
        {unreadable && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            A saved secret can&apos;t be decrypted. This happens if <code className="text-xs">AUTH_SECRET</code> changed. Enter it
            again to fix push.
          </p>
        )}
        {enabled && lastError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            The last push failed: {lastError} It will try again on the next check.
          </p>
        )}
        {enabled && !lastError && lastOk && <p className="text-xs text-muted-foreground">Last message sent {lastOk}.</p>}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Send push notifications
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label className="flex items-center gap-1.5">
              Service <FieldHelp id="push.type" />
            </Label>
            <Select value={type} onValueChange={(v) => v && setType(v as PushType)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => PUSH_TYPES.find((t) => t.value === v)?.label ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PUSH_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!telegram && (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="push-url" className="flex items-center gap-1.5">
                Webhook URL <FieldHelp id="push.url" />
              </Label>
              <Input
                id="push-url"
                type="password"
                autoComplete="off"
                placeholder={urlStored && !clearUrl ? "•••••••• (unchanged)" : URL_PLACEHOLDER[type]}
                disabled={clearUrl}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {urlStored && (
                <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setClearUrl((c) => !c)}>
                  {clearUrl ? "Keep saved URL" : "Remove saved URL"}
                </button>
              )}
            </div>
          )}

          <div className="col-span-2 space-y-1.5 sm:col-span-1">
            <Label htmlFor="push-token" className="flex items-center gap-1.5">
              {telegram ? "Bot token" : "Token (optional)"} <FieldHelp id="push.token" />
            </Label>
            <Input
              id="push-token"
              type="password"
              autoComplete="off"
              placeholder={tokenStored && !clearToken ? "•••••••• (unchanged)" : ""}
              disabled={clearToken}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {tokenStored && (
              <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setClearToken((c) => !c)}>
                {clearToken ? "Keep saved token" : "Remove saved token"}
              </button>
            )}
          </div>

          {telegram && (
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="push-chat" className="flex items-center gap-1.5">
                Chat ID <FieldHelp id="push.chat-id" />
              </Label>
              <Input id="push-chat" placeholder="-1001234567890" value={chatId} onChange={(e) => setChatId(e.target.value)} />
            </div>
          )}
        </div>

        {enabled && !sameType && (hasStoredUrl || hasStoredToken) && (
          <Warning>Changing the service removes the saved URL and token. Enter new ones.</Warning>
        )}

        <div className="flex items-center gap-2">
          <Button type="button" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={test}>Send test message</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The test uses what&apos;s typed above, so you can try settings before saving. Leave a secret blank to keep
          the saved one. The first time you turn push on, reminders already in the list are not sent.
        </p>
      </CardContent>
    </Card>
  )
}
