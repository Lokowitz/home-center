import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { redirect } from "next/navigation"
import { UserManagement } from "@/components/settings/user-management"
import { EmailPreferences } from "@/components/settings/email-preferences"
import { NotificationRecipients } from "@/components/settings/notification-recipients"
import { RepeatPreferences } from "@/components/settings/repeat-preferences"
import { MailSettings } from "@/components/settings/mail-settings"
import { LlmSettings } from "@/components/settings/llm-settings"
import { loadMailConfig, SETTINGS_ID } from "@/lib/notifications/mail-config"
import { isMailConfigured } from "@/lib/notifications/mailer"
import { loadLlmConfig, loadLlmStatus } from "@/lib/llm/config"
import { cookies } from "next/headers"
import { PLACEMENTS, readPlacement } from "@/lib/placement"
import { PlacementSettings } from "@/components/settings/placement-settings"
import { isLlmReady, parseExtraBody } from "@/lib/llm/settings-schema"
import { DocumentSettings } from "@/components/settings/document-settings"
import { CaptureSettings } from "@/components/settings/capture-settings"
import { loadCaptureParser } from "@/lib/capture-server"
import { loadDocumentSettings } from "@/lib/documents/settings"
import { documentIndexStats } from "@/lib/documents/indexer-server"
import { loadModelStatus } from "@/lib/documents/embed/server"
import { SettingsNav } from "@/components/settings/settings-nav"
import { FeatureSettings } from "@/components/settings/feature-settings"
import { RegionalSettingsForm } from "@/components/settings/regional-settings"
import { loadRegionalSettings } from "@/lib/regional-server"
import { loadFeatures } from "@/lib/features-server"
import { DataSettings } from "@/components/settings/data/data-settings"
import { loadBackupOverview } from "@/lib/backup/overview-server"
import { resolveSection, visibleSections, type SettingsSectionId } from "@/lib/settings-sections"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const isAdmin = session.user.role === "ADMIN"
  const sections = visibleSections(isAdmin)
  const section = resolveSection((await searchParams).tab, isAdmin)
  const is = (id: SettingsSectionId) => section.id === id

  // Every account reaches Settings: email cadence is a personal preference, so
  // gating the whole page on ADMIN would leave ordinary users unable to turn
  // their own mail off. resolveSection keeps the admin-only sections from
  // non-admins, and only the open section's data is loaded.
  const [me, users, recipients, mail, storedMail, llm, docs, features, capture, appearance, backup, regional] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { emailDigest: true, email: true, receivesNotifications: true, notificationRepeat: true },
    }),
    // Only what the table shows: the rows are sent to the browser, so no password hashes.
    is("users")
      ? prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, mustResetPassword: true }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    is("notifications") && isAdmin
      ? prisma.user.findMany({
          select: { id: true, name: true, email: true, role: true, receivesNotifications: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    is("notifications") || is("mail") ? loadMailConfig() : Promise.resolve(null),
    is("mail") ? prisma.mailSettings.findUnique({ where: { id: SETTINGS_ID } }) : Promise.resolve(null),
    is("assistant") ? loadLlmConfig() : Promise.resolve(null),
    is("documents")
      ? Promise.all([loadDocumentSettings(), documentIndexStats(), loadModelStatus()])
      : is("assistant")
        ? loadDocumentSettings().then((d) => [d, null, null] as const)
        : Promise.resolve(null),
    is("features") || is("assistant") ? loadFeatures() : Promise.resolve(null),
    is("documents")
      ? Promise.all([loadCaptureParser(), loadLlmConfig()]).then(([mode, c]) => ({ mode, llmReady: isLlmReady(c) }))
      : Promise.resolve(null),
    is("appearance")
      ? Promise.all([loadLlmStatus(), cookies()]).then(([s, jar]) => ({
          assistant: readPlacement("assistant", jar.get(PLACEMENTS.assistant.cookie)?.value),
          intake: readPlacement("intake", jar.get(PLACEMENTS.intake.cookie)?.value),
          // Same rule as the layout.
          assistantShown: s.available,
        }))
      : Promise.resolve(null),
    is("data") ? loadBackupOverview() : Promise.resolve(null),
    is("regional") ? loadRegionalSettings() : Promise.resolve(null),
  ])
  // A signed-in session whose user row is gone — the demo seeder wipes users,
  // so a cookie from before it survives the account it points at. Redirecting
  // to /login would bounce straight back here: proxy.ts sends anyone holding a
  // valid session away from /login, so the two would ping-pong and Settings
  // would look like it "goes to the dashboard". Say what's wrong instead.
  if (!me) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="font-heading text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          The account you&apos;re signed in as no longer exists. Sign out from the menu in the top
          right, then sign in again.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
      </div>

      {/* One shrinkable column on phones: an implicit auto column grew to the tab strip's width and pushed the page sideways. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[12.5rem_minmax(0,1fr)]">
        {sections.length > 1 && (
          <aside className="md:sticky md:top-0 md:self-start">
            <SettingsNav sections={sections} active={section.id} />
          </aside>
        )}

        <div className={sections.length > 1 ? "min-w-0 max-w-3xl" : "min-w-0 max-w-3xl md:col-span-2"}>
          {is("notifications") && mail && (
            <div className="space-y-6">
              <EmailPreferences
                digest={me.emailDigest}
                email={me.email}
                mailConfigured={isMailConfigured(mail)}
                receivesNotifications={me.receivesNotifications}
              />
              <RepeatPreferences repeat={me.notificationRepeat} />
              {isAdmin && <NotificationRecipients users={recipients} currentUserId={session.user.id} />}
            </div>
          )}

          {is("appearance") && appearance && (
            <div className="space-y-6">
              <PlacementSettings
                prefKey="intake"
                title="Intake"
                description="Where Intake, with its count of receipts to review, sits. Saved for this browser only."
                initial={appearance.intake}
              />
              <PlacementSettings
                prefKey="assistant"
                title="Assistant button"
                description={
                  "Where the button that opens the assistant sits. Saved for this browser only." +
                  (appearance.assistantShown ? "" : " The assistant is currently hidden, so neither shows.")
                }
                initial={appearance.assistant}
              />
            </div>
          )}

          {is("features") && features &&<FeatureSettings initial={{ healthEnabled: features.health, roomsEnabled: features.rooms, equipmentTabEnabled: features.equipmentTab }} />}

          {is("regional") && regional && <RegionalSettingsForm initial={regional} />}

          {is("mail") && mail && (
            <MailSettings
              // Seeded from the resolved config so the form shows what is actually
              // in effect, whether that came from Settings or the environment. The
              // password is never sent — only whether one is stored.
              initial={{
                host: mail.host ?? "",
                port: String(mail.port),
                username: mail.username ?? "",
                secure: storedMail?.secure == null ? "auto" : String(storedMail.secure),
                fromAddress: mail.from,
                digestHour: String(mail.digestHour),
                publicUrl: mail.publicUrl ?? "",
              }}
              sources={mail.sources}
              hasStoredPassword={Boolean(storedMail?.passwordEnc)}
              passwordUnreadable={mail.passwordUnreadable}
              configured={isMailConfigured(mail)}
              dryRun={mail.dryRun}
            />
          )}

          {is("assistant") && llm && (
            <LlmSettings
              // The key itself is never sent — only whether one is stored.
              initial={{
                enabled: llm.enabled,
                hidden: llm.hidden,
                baseUrl: llm.baseUrl ?? "",
                model: llm.model ?? "",
                temperature: llm.temperature?.toString() ?? "",
                maxTokens: llm.maxTokens?.toString() ?? "",
                systemPrompt: llm.systemPrompt ?? "",
                timeoutSeconds: llm.timeoutSeconds?.toString() ?? "",
                maxToolRounds: llm.maxToolRounds?.toString() ?? "",
                extraBody: llm.extraBody ? JSON.stringify(parseExtraBody(llm.extraBody), null, 2) : "",
                documentsEnabled: llm.documentsEnabled,
                healthDocumentsEnabled: llm.healthDocumentsEnabled,
              }}
              indexingEnabled={docs?.[0].indexingEnabled ?? true}
              healthEnabled={features?.health ?? true}
              hasStoredKey={llm.hasStoredKey}
              keyUnreadable={llm.keyUnreadable}
              ready={isLlmReady(llm)}
            />
          )}

          {is("documents") && docs && docs[1] !== null && docs[2] !== null && (
            <div className="space-y-6">
              <DocumentSettings
                initial={{
                  indexingEnabled: docs[0].indexingEnabled,
                  ocrEnabled: docs[0].ocrEnabled,
                  semanticEnabled: docs[0].semanticEnabled,
                }}
                stats={docs[1]}
                models={docs[2]}
              />
              {capture && <CaptureSettings initial={capture.mode} llmReady={capture.llmReady} />}
            </div>
          )}

          {is("data") && backup && <DataSettings initial={backup} />}

          {is("users") && <UserManagement users={users} currentUserId={session.user.id} />}
        </div>
      </div>
    </div>
  )
}
