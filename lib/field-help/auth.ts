import type { FieldHelpMap } from "./types"

export const AUTH_HELP: FieldHelpMap = {
  "auth.email": {
    title: "Email",
    what: "The email address of your HomeCenter account. Whoever set up HomeCenter created the account and can tell you which address it uses.",
  },
  "auth.password": {
    title: "Password",
    what: "The password for your account on this HomeCenter server.",
    use: "After too many wrong tries, sign-in pauses for 15 minutes.",
  },
  "auth.reset-email": {
    title: "Email",
    what: "The email address you sign in with.",
    use: "If it belongs to an account, HomeCenter emails a reset link there. The link works once and expires after 15 minutes.",
  },
  "auth.reset-code": {
    title: "Reset code",
    what: "The code from the password reset email. Paste it here if the email gave you a code instead of a link.",
    use: "It works once and expires 15 minutes after it was sent.",
  },
  "auth.current-password": {
    title: "Current password",
    what: "The password you use to sign in now. It proves it's really you before the password changes.",
  },
  "auth.new-password": {
    title: "New password",
    what: "The password you'll sign in with from now on. Use at least 6 characters.",
    use: "Saving it signs this account out on every device, so you sign in again with the new one.",
  },
  "auth.confirm-password": {
    title: "Confirm password",
    what: "Type the new password again to catch typos. Both must match.",
  },
}
