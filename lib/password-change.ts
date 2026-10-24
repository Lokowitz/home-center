export const MIN_PASSWORD_LENGTH = 6

export type PasswordChangeError = "wrong-current" | "short" | "mismatch"

export const PASSWORD_ERROR_TEXT: Record<PasswordChangeError, string> = {
  "wrong-current": "Your current password is not correct.",
  short: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: "Passwords do not match.",
}

/** Which field of the change-password form an error belongs to. */
export const PASSWORD_ERROR_FIELD: Record<PasswordChangeError, "current" | "next" | "confirm"> = {
  "wrong-current": "current",
  short: "next",
  mismatch: "confirm",
}

/**
 * Someone holding only a signed-in browser must not be able to set a new
 * password, so the current one is required — except on a forced reset, where
 * the temporary password was used to sign in moments ago.
 */
export async function checkPasswordChange(
  input: { current: string; next: string; confirm: string },
  account: { mustResetPassword: boolean; passwordHash: string },
  compare: (password: string, hash: string) => Promise<boolean>
): Promise<PasswordChangeError | null> {
  if (!account.mustResetPassword && !(input.current && (await compare(input.current, account.passwordHash)))) {
    return "wrong-current"
  }
  if (input.next.length < MIN_PASSWORD_LENGTH) return "short"
  if (input.next !== input.confirm) return "mismatch"
  return null
}
