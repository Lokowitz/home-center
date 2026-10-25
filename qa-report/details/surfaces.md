# QA report: surfaces

Scripts are in scratchpad\qa\surfaces\. Screenshots are in scratchpad\qa\shots\ and start with "surf-". The dev server was slow under load from other agents, so I used 60s timeouts. No failures came from that.

## 1. Coverage

| Feature or flow | Desktop | Phone | Result | Notes |
|---|---|---|---|---|
| /notifications list, unread count, links | yes | yes | pass | Links resolve to the right records. |
| Dismiss (double-click) | yes | no | pass | DB shows isRead=1 and dismissedAt set once. The count dropped by 1. |
| Show hidden / Restore | yes | no | pass | A restored item stays read (see U2). |
| Mark all read (page) | no | yes | pass | The DB changed only for non-dismissed items. A reload shows "All caught up". |
| Notification filters | yes | no | pass | The only filter is "Show hidden". |
| Click a notification on the page marks it read | yes | no | fail | See U1. |
| Header bell: open, count, Escape, width at 375 | yes | yes | pass | The menu is 320px wide at 375. |
| Bell per-item Dismiss and click-to-mark-read | no | no | skipped | My mark-all-read had already cleared every unread notification, and I can't create new ones. |
| Reminder Complete / Snooze buttons on notifications | no | no | skipped | These belong to the maintenance flow. |
| /search keyword: partial words, case, multi-word, empty, blank, no results | yes | yes | pass | Empty and blank queries show the intro page. "zzzqqxx" shows the no-result state. |
| /search special characters (& < > ' " % _ * \ emoji, script tag, 3000 chars) | yes | yes | pass with W1, U3 | No 5xx and no overflow. |
| /search matches per entity type | yes | no | partial | I saw properties, equipment, people, service, maintenance, warranties, rooms, health, insurance, providers, documents and vehicles. Other agents deleted some of their QA records mid-run, so I could not re-test every type. |
| Result links open the right record | yes | no | pass with U4 | Equipment, maintenance, medication, service record, State Farm and Chubb each opened the correct page and dialog. A provider result opens only the /providers list. |
| Header search box: "/" focus, Enter, blank, box shows the query, back | yes | yes | pass | The phone icon opens a search bar over the header. |
| /reports/[type]/[id] for properties, vehicles, equipment, people | yes | no | pass | Maple Street House: cost total $2,215 equals 1,450+540+225, owned cost $344,215 is correct, and the maintenance dates are correct. |
| Reports at tablet (768) | yes | n/a | pass | No horizontal scroll. The person report's options panel sits beside the sheet. |
| Reports: print layout | yes | n/a | pass | I used print media emulation and PDF export. No `.no-print` element shows. There is no sidebar or header, and the PDF generated. I did not read the PDFs page by page. |
| Report 404s (bad id, bad type) | yes | no | pass with N1 | |
| Sidebar: all 13 links, active state | yes | no | pass | Settings pages also highlight the Settings link. A subpage keeps its parent active. |
| Sidebar collapse/expand | yes | n/a | pass | Width goes 224 to 64 and the `hc-sidebar` cookie sets. It survives a reload. The tooltip shows the label. |
| Back/forward | yes | yes | pass | |
| Mobile menu (open, close with Escape, close with overlay, link closes it) | n/a | yes | pass | |
| User menu | no | yes | pass | |
| /intake page load | yes | yes | pass | |
| Logged out: /login, /reset-password page load | yes | yes | pass | A fresh context with no cookie. |
| Logged out: protected routes | yes | yes | pass with N2 | /, /settings, /intake, /notifications, /search, /reports/* and /api/files/* redirect to /login. |
| /forgot-password logged out | yes | yes | not testable | It redirects to /login by design when no mail server is configured. The code confirms this. I did not submit it. |
| Logout | yes | no | pass | It lands on /login. The session cookie is gone, protected pages redirect, and Back stays on /login. |
| 404 page: bad route, bad id | yes | yes | pass | Bad route gives a styled 404. Bad asset id gives "Not found / This item doesn't exist or may have been deleted." |
| Wrong-password login attempt | no | no | skipped | The login throttle is per IP and could lock out other agents. |

## 2. Findings

### D
None found.

### W

**W1. A property or asset name ending in an emoji breaks hydration on the Dashboard.**
- Cause: `initialsOf()` in lib/asset-visuals.ts uses `parts[0][0] + parts[last][0]`, which splits a surrogate pair.
- Repro: have a property named `QA-places Prop "A" <b>&'é 🏠` (it exists). Open `/` and watch the console.
- Expected: the tile shows "QP" or a complete character, with no console error.
- Actual: the tile text is "Q" plus a lone surrogate. The server sends U+FFFD and the client has the raw surrogate. The page throws "Hydration failed because the server rendered text didn't match the client" on every load, on desktop and phone, and React regenerates the tree.
- Likely fix: take the first code point, for example `Array.from(s)[0]` or `[...s][0]`.

**W2. Search treats `_` and `%` as LIKE wildcards.**
- Repro: search `QA_places` or `QA%places`. Also search `qa-%`.
- Expected: no matches, since there is no literal underscore or percent sign, or at least no widening.
- Actual: `QA_places` and `QA%places` return the same 14 matches as `QA-places`. `qa-%` returns 41 matches.
- Impact: low, because it only widens results.

### U

**U1. A notification link on /notifications does not mark the notification read.**
- Repro: click "Chubb Personal umbrella" on the page, then go Back.
- Expected: it is read, as in the header bell. The bell's click handler calls `markNotificationRead`.
- Actual: DB isRead stays 0, and it still shows "New" and counts as unread.
- The page also has no per-item "mark read". The only ways to clear one are Dismiss, which hides it, or Mark all read.

**U2. Restore keeps the notification read.**
- Dismiss and Restore leave the item read, with no way to mark it unread again. This is probably fine, but the dismissed state of the earlier smoke-alarm item read oddly.

**U3. Search says "Nothing matched" for queries that reduce to no terms.**
- Examples: `the`, `&`, `é`, `-`, and any single character. Stop words, punctuation and 1-character terms are dropped.
- The user is told "Nothing matched “&”" and "Try fewer or different words", which is misleading.
- Non-ASCII case-folding was only checked for `<b>&'É`, which matched. I did not test other non-ASCII uppercase.

**U4. A provider search result links to the /providers list.**
- It does not open or highlight the provider, unlike the other record types, which open a dialog.

**U5. At phone width the Notifications header row overflows.**
- Repro: 375px width with unread items. The row has "Show hidden (1)" and "Mark all read".
- Actual: "Mark all read" is clipped at the right edge ("Mark all"). See shot surf-notif-phone.png.
- Fix idea: let the row wrap.

**U6. At tablet width (768) the header search box is truncated to "Sea".**
- It sits beside the property filter, the theme switcher and the icons. See surf-tablet-dash.png.

**U7. The default header search (semantic on) shows "Semantic search isn't ready" on every search.**
- This happens when no semantic model is installed. It is a note on every result page until the user toggles the switch off.
- It does not persist the choice.

### N

**N1. Report 404s use Next's default unstyled page.**
- `/reports/equipment/doesnotexist` and `/reports/bogus/x` show "404: This page could not be found." The in-app 404 is styled.
- Bad asset ids inside the app return HTTP 200 with a "Not found" body (streamed), not a 404 status.
- The noindex meta tag is present.

**N2. Redirect to /login drops the destination.**
- A logged-out visit to a deep link goes to /login with no callbackUrl.

**N3. The notifications page caps at 100 items (`take: 100`) with no pagination.**
- That is a code observation. I did not test it.

**N4. Quoted phrase searches of one character match almost everything.**
- Example: `"A" <b>` returned 92 matches.

## 3. QA records I left behind
None created. The only data I changed:
- All notifications were marked read through "Mark all read". They stay read. The Chubb notification was dismissed and restored, and it is now read and not dismissed.
- One browser state change: my browser contexts' sidebar cookie. Nothing else.

## 4. Not tested, and why
- Bell per-item Dismiss and click-to-read, because nothing unread was left.
- Notification Complete and Snooze actions, which belong to the maintenance flow.
- Submitting /forgot-password. This was forbidden, and the page redirects when mail is off.
- A wrong-password login, to avoid triggering the throttle.
- Semantic search. This was out of scope.
- A /search match for every entity type after other agents deleted some QA records. Search results were therefore verified for properties, equipment, people, service records, rooms and health records only at the time they existed.
- Sidebar active state with Assistant or Intake in the sidebar. Both are hidden in this setup (assistant not configured, Intake in the header).
- A role=USER account does not exist.
