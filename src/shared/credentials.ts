// Rules for the saved logins. Pure, so it is unit-testable.

/** A saved login as the UI sees it. The password never leaves the main process. */
export interface LoginAccount { name: string; origin: string; username: string }

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** The origin a login belongs to; null for a URL a password must not be sent to (anything but https, or http on this machine). */
export function loginOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.includes(u.hostname))) return u.origin
  } catch { /* not a URL */ }
  return null
}
