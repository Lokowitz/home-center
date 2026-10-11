// Whether the desktop sidebar is collapsed to icons. Kept in a cookie so the
// server renders the right width and the page doesn't jump on load.

export const SIDEBAR_COOKIE = "hc-sidebar"
const YEAR_SECONDS = 60 * 60 * 24 * 365

export function readSidebarCollapsed(value: string | undefined): boolean {
  return value === "collapsed"
}

/** A document.cookie assignment for the choice. */
export function sidebarCookie(collapsed: boolean): string {
  return `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`
}
