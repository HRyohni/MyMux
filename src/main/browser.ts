import { BrowserWindow, WebContentsView, app } from 'electron'
import { chromium, type Browser, type Page } from 'playwright-core'
import { isAbsolute, resolve } from 'node:path'
import type { BrowserState, Rect } from '../shared/ipc'
import { toViewableUrl } from './documents'

/**
 * One embedded Chromium view per chat session, rendered inside the app window where the user
 * can see it, and driven by Playwright over CDP so Claude can use the same page.
 */
export class SessionBrowser {
  readonly view: WebContentsView
  private page: Page | null = null
  private visible = false
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private readonly marker: string

  constructor(
    readonly sessionId: string,
    private readonly cwd: string,
    private readonly win: BrowserWindow,
    private readonly cdp: () => Promise<Browser>,
    private readonly onState: (state: BrowserState) => void,
  ) {
    this.marker = `aimux-${sessionId}`
    this.view = new WebContentsView({
      webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    this.view.setVisible(false)
    win.contentView.addChildView(this.view)

    const wc = this.view.webContents
    wc.setWindowOpenHandler(({ url }) => {
      void wc.loadURL(url)
      return { action: 'deny' }
    })
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'did-fail-load'] as const) {
      wc.on(ev as 'did-navigate', () => this.emitState())
    }
    wc.on('page-title-updated', () => this.emitState())
    void wc.loadURL(`data:text/html,<title>${this.marker}</title><body style="background:%230f1115"></body>`)
  }

  state(): BrowserState {
    const wc = this.view.webContents
    const url = wc.getURL()
    return {
      sessionId: this.sessionId,
      url: url.startsWith('data:') ? '' : url,
      title: url.startsWith('data:') ? '' : wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    }
  }

  private emitState() {
    if (this.view.webContents.isDestroyed()) return
    this.onState(this.state())
  }

  setBounds(b: Rect) {
    this.bounds = b
    if (this.visible) this.view.setBounds(b)
  }

  setVisible(v: boolean) {
    this.visible = v
    this.view.setVisible(v)
    if (v) this.view.setBounds(this.bounds)
  }

  // ---- user-facing controls -------------------------------------------------

  navigate(url: string) {
    const u = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
    return this.view.webContents.loadURL(u)
  }
  back() { this.view.webContents.navigationHistory.goBack() }
  forward() { this.view.webContents.navigationHistory.goForward() }
  reload() { this.view.webContents.reload() }

  async openFile(path: string) {
    const abs = isAbsolute(path) ? path : resolve(this.cwd, path)
    const url = await toViewableUrl(abs)
    await this.view.webContents.loadURL(url)
  }

  // ---- Playwright access ----------------------------------------------------

  /** Resolve the Playwright Page that corresponds to this view (matched by the marker title). */
  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    const browser = await this.cdp()
    const wc = this.view.webContents
    const wanted = wc.getURL()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          if (p.url() === wanted) {
            this.page = p
            p.setDefaultTimeout(8000)
            return p
          }
        }
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('Playwright nije pronašao stranicu browser panela')
  }

  async waitSettled(ms = 1500) {
    const p = await this.getPage()
    await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {})
    await p.waitForLoadState('networkidle', { timeout: ms }).catch(() => {})
  }

  destroy() {
    try { this.win.contentView.removeChildView(this.view) } catch { /* window gone */ }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
}

/** Lazily connects Playwright to this Electron process over CDP. */
export class CdpConnection {
  private browser: Promise<Browser> | null = null
  constructor(private readonly port: number) {}

  get = (): Promise<Browser> => {
    if (!this.browser) {
      this.browser = chromium.connectOverCDP(`http://127.0.0.1:${this.port}`).then((b) => {
        b.on('disconnected', () => { this.browser = null })
        return b
      }).catch((e) => { this.browser = null; throw e })
    }
    return this.browser
  }
}

export function enableRemoteDebugging(port: number) {
  app.commandLine.appendSwitch('remote-debugging-port', String(port))
  app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${port}`)
}
