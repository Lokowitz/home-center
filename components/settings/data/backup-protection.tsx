"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { KeyRound, Lock, ShieldOff, Download } from "lucide-react"
import { generateX25519Identity, identityToRecipient } from "age-encryption"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldHelp } from "@/components/ui/field-help"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { setProtectionKey, setProtectionNone, setProtectionPassword } from "@/lib/actions/backup"
import { fingerprintOf, passwordProblem } from "@/lib/backup/protect-shared"
import type { BackupOverview } from "@/lib/backup/overview-server"
import { recoveryKitText } from "./recovery-kit"

type Mode = "NONE" | "KEY" | "PASSWORD"
const OPTIONS: { mode: Mode; icon: React.ElementType; title: string; body: string }[] = [
  { mode: "NONE", icon: ShieldOff, title: "No protection", body: "Plain zip. Opens anywhere. Anyone who gets the file can read it." },
  { mode: "KEY", icon: KeyRound, title: "Recovery key", body: "You keep a key file. The server can make backups but can't open them. Strongest." },
  { mode: "PASSWORD", icon: Lock, title: "Password zip", body: "Opens in 7-Zip, WinRAR or Keka with your password. The server stores the password to make scheduled backups." },
]

export function BackupProtection({ data, onSaved }: { data: BackupOverview; onSaved: () => Promise<void> }) {
  const current = data.settings.protection
  const [dialog, setDialog] = useState<Mode | null>(null)
  const [pending, start] = useTransition()

  function choose(mode: Mode) {
    if (mode === current && mode !== "KEY" && mode !== "PASSWORD") return
    if (mode === "NONE") {
      if (!window.confirm("Turn protection off? New backups will be readable by anyone who gets the file. Existing protected backups stay protected.")) return
      start(async () => {
        const r = await setProtectionNone()
        if ("error" in r) toast.error(r.error)
        else toast.success("Protection turned off for new backups.")
        await onSaved()
      })
      return
    }
    setDialog(mode)
  }

  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle className="flex items-center gap-1.5">Protection<FieldHelp id="backup.protection" /></CardTitle>
        <CardDescription>Applies to new backups. Each backup in the list shows how it was protected.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            disabled={pending}
            onClick={() => choose(o.mode)}
            aria-pressed={current === o.mode}
            className={cn("rounded-lg border p-3 text-left transition-colors hover:bg-muted/50", current === o.mode && "border-primary ring-1 ring-primary")}
          >
            <span className="flex items-center gap-2 text-sm font-medium"><o.icon className="h-4 w-4" aria-hidden="true" />{o.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{o.body}</span>
            {current === o.mode && o.mode === "KEY" && data.settings.keyFingerprint && (
              <span className="mt-2 block text-xs">Key {data.settings.keyFingerprint} · <span className="underline">make a new key</span></span>
            )}
            {current === o.mode && o.mode === "PASSWORD" && <span className="mt-2 block text-xs underline">Change password</span>}
          </button>
        ))}
      </CardContent>
      {dialog === "KEY" && <KeyDialog onClose={() => setDialog(null)} onSaved={onSaved} replacing={current === "KEY"} />}
      {dialog === "PASSWORD" && <PasswordDialog onClose={() => setDialog(null)} onSaved={onSaved} />}
    </Card>
  )
}

function KeyDialog({ onClose, onSaved, replacing }: { onClose: () => void; onSaved: () => Promise<void>; replacing: boolean }) {
  const [kit, setKit] = useState<{ identity: string; recipient: string; fingerprint: string } | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  async function make() {
    // Generated here, in the browser: only the public half is ever sent.
    const identity = await generateX25519Identity()
    const recipient = await identityToRecipient(identity)
    setKit({ identity, recipient, fingerprint: await fingerprintOf(recipient) })
  }

  function download() {
    if (!kit) return
    const blob = new Blob([recoveryKitText({ ...kit, created: new Date() })], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "homecenter-recovery-key.txt"
    // Some browsers only download from an anchor in the document, and start reading the blob after click() returns.
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    setDownloaded(true)
  }

  function finish() {
    if (!kit) return
    start(async () => {
      const r = await setProtectionKey({ publicKey: kit.recipient, fingerprint: kit.fingerprint })
      if ("error" in r) return void toast.error(r.error)
      toast.success(`Recovery key ${kit.fingerprint} is now used for new backups.`)
      setKit(null) // drop the private key from memory
      await onSaved()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{replacing ? "Make a new recovery key" : "Set up a recovery key"}</DialogTitle>
          <DialogDescription>
            HomeCenter makes the key in this browser and keeps only its public half. You download the key itself, once.
            {replacing ? " Older backups still need the old key file." : ""}
          </DialogDescription>
        </DialogHeader>
        {!kit ? (
          <Button onClick={() => void make()}>Make my key</Button>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Fingerprint <span className="font-mono">{kit.fingerprint}</span></p>
            <Button variant="outline" onClick={download}><Download className="h-4 w-4" aria-hidden="true" />Download recovery key</Button>
            <Label help="backup.key-saved" className="items-start font-normal leading-normal">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={saved} disabled={!downloaded} onChange={(e) => setSaved(e.target.checked)} />
              <span>I saved the key somewhere other than this server. I understand backups made with it can&apos;t be opened without it.</span>
            </Label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!kit || !saved || pending} onClick={finish}>Use this key</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PasswordDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [pw, setPw] = useState("")
  const [again, setAgain] = useState("")
  const [pending, start] = useTransition()
  const problem = pw ? passwordProblem(pw) : null
  const mismatch = again && pw !== again ? "The passwords don't match." : null

  function save(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await setProtectionPassword({ password: pw })
      if ("error" in r) return void toast.error(r.error)
      toast.success("New backups will be password zips.")
      await onSaved()
      onClose()
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Password for backups</DialogTitle>
            <DialogDescription>
              At least 6 characters. HomeCenter stores it encrypted to make scheduled backups, so anyone with both your data folder and AUTH_SECRET could open them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bk-pw" help="backup.password">Password</Label>
            <Input id="bk-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            {problem && <p className="text-xs text-destructive">{problem}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-pw2" help="backup.password-again">Same password again</Label>
            <Input id="bk-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            {mismatch && <p className="text-xs text-destructive">{mismatch}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending || !pw || !!problem || pw !== again}>Save password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
