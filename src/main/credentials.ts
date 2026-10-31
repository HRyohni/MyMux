import { app, dialog, safeStorage, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Frame, Locator } from 'playwright-core'
import type { SessionBrowser } from './browser'
import { loginOrigin, type LoginAccount } from '../shared/credentials'

/**
 * Saved logins. Passwords are encrypted with the Windows account (safeStorage) and are only ever
 * decrypted here, to be typed into a page. They never reach the renderer, Claude or a tool result.
 */

interface Stored extends LoginAccount { secret: string }

const file = () => join(app.getPath('userData'), 'credentials.json')

function read(): Stored[] {
  if (!existsSync(file())) return []
  try { return JSON.parse(readFileSync(file(), 'utf-8')) as Stored[] } catch { return [] }
}

export const listLogins = (): LoginAccount[] => read().map(({ name, origin, username }) => ({ name, origin, username }))

export function saveLogin(name: string, url: string, username: string, password: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Šifriranje lozinki nije dostupno na ovom računalu')
  const origin = loginOrigin(url)
  if (!origin) throw new Error('Adresa mora biti https (http samo za localhost)')
  if (!/^[\w.-]+$/.test(name)) throw new Error('Naziv smije imati slova, brojke, točku, crticu i podvlaku')
  if (!username || !password) throw new Error('Upiši korisničko ime i lozinku')
  const secret = safeStorage.encryptString(password).toString('base64')
  writeFileSync(file(), JSON.stringify([...read().filter((a) => a.name !== name), { name, origin, username, secret }], null, 2))
}

export function deleteLogin(name: string) {
  writeFileSync(file(), JSON.stringify(read().filter((a) => a.name !== name), null, 2))
}

const PASSWORD = 'input[type="password"]'
const USERNAME = [
  'input[autocomplete="username"]', 'input[autocomplete="email"]', 'input[type="email"]',
  'input[name*="user" i]', 'input[name*="mail" i]', 'input[name*="login" i]', 'input[id*="user" i]', 'input[id*="mail" i]', 'input[id*="login" i]',
].join(', ')

/** Asks in a native dialog, which nothing in the conversation or on the page can answer. */
async function approve(win: BrowserWindow, account: Stored, url: string, approved: Set<string>): Promise<boolean> {
  if (approved.has(account.name)) return true
  if (!app.isPackaged && process.env.MYMUX_AUTOANSWER === 'allow') return true
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'mymux',
    message: `Claude se želi prijaviti kao ${account.username}`,
    detail: `Račun: ${account.name}\nStranica: ${url}\n\nClaude neće vidjeti lozinku, ali nakon prijave može raditi u tom računu sve što možeš i ti.`,
    buttons: ['Odbij', 'Dopusti jednom', 'Dopusti za ovaj razgovor'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (response === 2) approved.add(account.name)
  return response > 0
}

/**
 * Types a saved login into the page and submits it. The result says only what happened. Errors are
 * replaced by a fixed text, so nothing Playwright reports about the fill can carry the password.
 */
export async function runLogin(b: SessionBrowser, win: BrowserWindow, name: string, approved: Set<string>): Promise<string> {
  const account = read().find((a) => a.name === name)
  if (!account) return `Račun "${name}" ne postoji. Pozovi browser_login bez računa za popis.`
  const p = await b.getPage()
  const onOrigin = () => loginOrigin(p.url()) === account.origin
  if (!onOrigin()) return `Račun "${name}" vrijedi samo za ${account.origin}. Trenutna stranica je druga, pa ništa nije upisano. Prvo otvori stranicu za prijavu tog računa.`
  if (!await approve(win, account, p.url(), approved)) return 'Korisnik nije dopustio prijavu.'

  // Only frames of the account's own site: a login form embedded from elsewhere gets nothing.
  const find = async (selector: string): Promise<Locator | null> => {
    if (!onOrigin()) return null
    for (const f of p.frames().filter((x: Frame) => loginOrigin(x.url()) === account.origin)) {
      const field = f.locator(selector).filter({ visible: true }).first()
      if (await field.count()) return field
    }
    return null
  }

  b.loginRunning = true
  try {
    let password = await find(PASSWORD)
    const user = await find(USERNAME)
    if (!password && !user) return 'Na stranici nema polja za prijavu.'
    if (user) await user.fill(account.username)
    // Sites that ask for the e-mail first show the password on the next step.
    if (!password && user) {
      await user.press('Enter')
      for (let i = 0; i < 16 && !password; i++) {
        await new Promise((r) => setTimeout(r, 500))
        if (!onOrigin()) return 'Stranica je preusmjerila prijavu na drugu domenu, pa lozinka nije upisana.'
        password = await find(PASSWORD)
      }
      if (!password) return 'Polje za lozinku se nije pojavilo, pa lozinka nije upisana.'
    }
    await password!.fill(safeStorage.decryptString(Buffer.from(account.secret, 'base64')))
    await password!.press('Enter')
    await b.waitSettled(2000)
    const left = await find(PASSWORD)
    if (!left) return `Prijava je poslana. Stranica: ${p.url()}`
    await left.fill('')
    return `Polje za lozinku je i dalje na stranici, pa prijava vjerojatno nije uspjela (kriva lozinka, 2FA ili captcha). Stranica: ${p.url()}`
  } catch {
    return 'Prijava nije dovršena zbog greške na stranici.'
  } finally {
    await find(PASSWORD).then((f) => f?.fill('')).catch(() => {})
    b.loginRunning = false
  }
}
