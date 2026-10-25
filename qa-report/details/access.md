# QA report: access (Settings > Users, roles, sessions, USER experience)

## 1. Coverage

| Feature / flow | Desktop | Phone | Result | Notes |
|---|---|---|---|---|
| Create user valid (USER, ADMIN) | yes | yes | pass | temp password shown, mustResetPassword=1 |
| Create: duplicate email | yes | no | pass | field error shown |
| Create: invalid email (`not-an-email`, `a@b`) | yes | yes | pass | native tooltip, or "Enter a valid email address." (plus a generic "Failed to create user." toast, U3) |
| Create: empty name | yes | no | pass | "Name is required" |
| Create: 400-char name | yes | no | FAIL | accepted, breaks layout (W3) |
| Create: odd chars (O'Brien, html tags, quotes, emoji, ñ, `;--`) | yes | no | pass | stored and rendered as text |
| Create: case-variant email, whitespace email | yes | no | partial | case duplicate accepted (W4); leading/trailing spaces trimmed |
| Create: double-click submit | no | yes | pass/U | one row created; second call raises a failed toast (U2) |
| "Short password under 6" at creation | n/a | n/a | n/a | creation has no password field (random temp password). Covered under change-password |
| Role change USER<->ADMIN | yes | no | pass | toast, DB, effect on a live session on its next request |
| Self role/delete/reset guard | yes | | pass | own row has no select/delete/reset; server also refuses (code read) |
| Last-admin guard | code read | | pass by construction | only a self-guard exists, so the acting admin always remains; see N3 |
| Reset password | yes | no | pass | confirm text, temp pw, "Must reset pw" badge, sessionVersion bump, live session ended |
| Delete user, no owned rows | yes | | pass | only User count changed (7 to 6); Property and ServiceRecord totals unchanged |
| Delete user WITH owned rows | yes | | FAIL | HTTP 500 (W2); no data lost, user kept |
| Deleted user's open session | yes | | pass | next request goes to /login |
| Real /login form, wrong password | yes | yes | pass | "Invalid email or password." Exactly 2 wrong attempts, both on qa-access-user |
| Forced change-password (first login and after reset) | yes | yes | pass | every route redirects to /change-password, no current-pw field, short/mismatch errors OK, then signed out with message |
| USER route sweep (37 routes) | yes | 4 routes | pass | see below |
| USER admin tabs hidden | yes | yes | pass | nav shows Notifications and Appearance only; ?tab=users etc. silently show Notifications (U4) |
| /settings/assistant-test as USER | yes | | pass | redirects to / |
| Admin APIs/actions as USER | yes | | pass | /api/assistant-test 403, /api/backup/download and /upload 401 (N1); every admin action file read, all guard server-side |
| USER Notifications prefs (digest, repeat) | yes | | pass | DB updated, persists reload |
| USER receive-notifications toggle | | | n/a | admin-only (recipients card), not shown to USER |
| Appearance: intake/assistant placement, theme, sidebar, view mode | yes | | pass | cookies hc-intake, hc-assistant, hc-sidebar, hc-view-properties; persist after reload; fresh browser context has none |
| Change own password (menu > Change Password) | yes | | pass | wrong current, short, mismatch errors; success signs out every session (second session ended), old pw rejected |
| Logout, back button, /settings after logout | yes | | pass | |
| Admin Users tab at phone width | | yes | FAIL | Actions column clipped (W5) |
| QA admin real login, tabs, own-row controls | yes | | pass | |
| Demotion while that user is signed in | yes | | pass | takes effect next request, tabs shrink |

USER sweep: every normal page loads (dashboard, asset lists/details/reminders, providers, records, costs, warranties, maintenance, insurance, notifications, search, intake, chat, settings, /settings/install). Redirects: /login and /forgot-password to /, /settings/assistant-test to /. /settings/install is open to every signed-in user by design (menu item "Install as app").

## 2. Findings

### D
None found. The failed delete of a user with rows left every row intact (owned ServiceRecord 1 and Observation 1 unchanged afterwards).

### W

**W2. Deleting a user who has ever created anything crashes with HTTP 500 and no message.**
Repro: as a USER create a service record or observation; as admin go to Settings > Users > Delete that user and confirm.
Expected: the delete works (rows kept or reassigned) or a clear toast ("This user has records and can't be deleted").
Actual: `prisma.user.delete()` throws an FK violation. ServiceRecord.createdById, Observation.createdById, Attachment.uploadedById and InboxItem.createdById have no onDelete rule (Notification and PasswordResetToken cascade). Response is HTTP 500, no toast, row stays (screenshot access-delete-victim). Any real account that has used the app can never be deleted. Attachment and InboxItem could not be created by me (uploads out of scope) but have the same schema rule. Notification cascade not exercised (victim had none).

**W3. A very long unbroken name makes every row's Email/Role/Actions unreachable.**
Repro: Add User with a 400-character name. createUser and updateSelf only check min(1), no max (email is capped at 254). The table grows to about 3900px inside an overflow-hidden card, so Role/Reset/Delete of all rows are clipped (screenshot access-users-list). The temp-password dialog for that name also overflows and its Done button is outside the viewport (only Escape closes it).
Expected: a name length limit and wrapping.

**W5. Users tab at 375px: Actions column cut off.** Reset pw, Delete, Change pw and Edit are clipped by the card's overflow-hidden (screenshot access-users-phone). An admin on a phone cannot reset, delete or edit anyone.

**W4. Emails are unique case-sensitively.** `QA-Access-User@example.test` was accepted next to `qa-access-user@example.test` (same mailbox). Sign-in looks up the exact string, so these are two separate logins, and a forgot-password request by email could hit the wrong one. Expected: case-insensitive duplicate check, or lower-case on save.

### U
- U1. A USER's email preferences text says "An administrator can configure one under Mail server below." The user has no Mail server tab and nothing below.
- U2. Create User double-click: the first call succeeds ("User created." plus temp password), the second fires "Failed to create user." (duplicate email).
- U3. Create User failures always add a generic "Failed to create user." toast on top of the field error that already explains it.
- U4. A USER opening `?tab=users` (or any admin tab) silently gets Notifications content with the URL unchanged. Safe, but no message.
- U5. Assistant placement card says "The assistant is currently hidden, so neither shows." It is unclear what "neither" refers to.
- U6. updateUserRole and resetUserPassword on an id that no longer exists (race with another admin deleting it) go to `prisma.update` unguarded and would 500 (code read, not executed).

### N
- N1. /api/backup/download and /api/backup/upload answer 401 to a signed-in non-admin (403 would be correct). /api/assistant-test correctly answers 403.
- N2. A forged-cookie session (token without `name`) shows "User" in the menu; a real login shows the real name. Test-cookie artifact only.
- N3. Last-admin protection is only "cannot change or delete yourself". Two admins demoting or deleting each other at the same moment could leave zero admins (code read only).
- N4. Next dev overlay showed "1 Issue" on /login after the wrong sign-in (dev only, not investigated).

## 3. QA records left behind
Users (password for reuse):
- QA-access User, qa-access-user@example.test, role USER, password qa-access-pw3 (prefs: DIGEST DAILY, repeat ONCE, was REACHED_AND_DUE)
- QA-access Admin, qa-access-admin@example.test, role ADMIN, password qa-access-admin1
- QA-access Odd O'Brien..., qa-access-odd@example.test, USER, password victim-pass1 (owns 1 service record and 1 observation, so undeletable per W2)
- QA-access Case (QA-Access-User@example.test), QA-access Space (qa-access-space@example.test), QA-access Dbl (qa-access-dbl@example.test), all still on temporary passwords
Other: property "QA-access Victim Prop" with service record "QA-access victim record"; person "QA-access Victim Person" with observation "QA-access victim observation".
Deleted by my tests: the 410-character-name user (qa-access-long@example.test).

## 4. Not tested
- Notifications owned by a deleted user (cascade): victim had none; schema cascades.
- Attachments and inbox items owned by a deleted user: need uploads (out of scope); same non-cascading FK as W2.
- Login throttle limits (10 per email, 30 per IP): deliberately not exercised.
- Edit Profile (updateSelf) email change: not in my scope list.
- Zero-admin race (N3): not executed.
- Receive-notifications toggle as USER: not shown to USER.
