import { BrowserWindow, WebContentsView, app } from 'electron'
import { chromium, type Browser, type Page } from 'playwright-core'
import { isAbsolute, join, resolve } from 'node:path'
import type { BrowserState, BrowserShortcut, FindResult, Rect } from '../shared/ipc'
import { toViewableUrl } from './documents'

interface Tab { id: string; view: WebContentsView; page: Page | null }

export interface BrowserEvents {
  onState(state: BrowserState): void
  onFind(result: FindResult): void
  onShortcut(shortcut: BrowserShortcut): void
}

/** Which session a page belongs to, so downloads can be reported to the right panel. */
const ownerByWebContents = new Map<number, string>()
export const sessionOfWebContents = (id: number): string | undefined => ownerByWebContents.get(id)

/**
 * The embedded Chromium tabs of one chat session, rendered inside the app window where the user
 * can see them, and driven by Playwright over CDP so Claude can use the same pages.
 */
export class SessionBrowser {
  private tabs: Tab[] = []
  private activeId = ''
  private visible = false
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private tabCounter = 0

  constructor(
    readonly sessionId: string,
    private readonly cwd: string,
    private readonly win: BrowserWindow,
    private readonly cdp: () => Promise<Browser>,
    private readonly events: BrowserEvents,
  ) {
    this.newTab()
  }

  private get active(): Tab { return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0] }

  /** The view of the active tab. */
  get view(): WebContentsView { return this.active.view }

  private blankUrl(tabId: string) {
    return `data:text/html,<title>mymux-${this.sessionId}-${tabId}</title><body style="background:%230f1115"></body>`
  }

  newTab(url?: string): string {
    const id = `t${++this.tabCounter}`
    const view = new WebContentsView({
      webPreferences: {
        plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: join(import.meta.dirname, '../preload/page.cjs'),
      },
    })
    view.setVisible(false)
    this.win.contentView.addChildView(view)
    const tab: Tab = { id, view, page: null }
    this.tabs.push(tab)

    const wc = view.webContents
    ownerByWebContents.set(wc.id, this.sessionId)
    wc.setWindowOpenHandler(({ url: target }) => {
      this.newTab(target)
      return { action: 'deny' }
    })
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'did-fail-load'] as const) {
      wc.on(ev as 'did-navigate', () => this.emitState())
    }
    wc.on('page-title-updated', () => this.emitState())
    wc.on('found-in-page', (_e, r) => {
      if (tab.id === this.activeId) this.events.onFind({ sessionId: this.sessionId, matches: r.matches, active: r.activeMatchOrdinal })
    })
    // The page has keyboard focus, so the renderer never sees these keys.
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      const ctrl = input.control || input.meta
      if (ctrl && !input.shift && key === 'f') { e.preventDefault(); this.events.onShortcut('find') }
      else if (ctrl && !input.shift && key === 't') { e.preventDefault(); this.events.onShortcut('newTab') }
      else if (ctrl && !input.shift && key === 'w') { e.preventDefault(); this.events.onShortcut('closeTab') }
      else if (ctrl && (key === '+' || key === '=')) { e.preventDefault(); this.setZoom(wc.getZoomFactor() + 0.1) }
      else if (ctrl && key === '-') { e.preventDefault(); this.setZoom(wc.getZoomFactor() - 0.1) }
      else if (ctrl && key === '0') { e.preventDefault(); this.setZoom(1) }
      else if (key === 'f12') { e.preventDefault(); this.devTools() }
    })
    void wc.loadURL(url ? this.normalize(url) : this.blankUrl(id)).catch(() => {})
    this.selectTab(id)
    return id
  }

  selectTab(id: string) {
    if (!this.tabs.some((t) => t.id === id)) return
    this.activeId = id
    for (const t of this.tabs) t.view.setVisible(this.visible && t.id === id)
    if (this.visible) this.active.view.setBounds(this.bounds)
    this.emitState()
  }

  closeTab(id: string) {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    if (this.tabs.length === 1) {
      // The panel always keeps one tab; closing the last one just empties it.
      void this.tabs[0].view.webContents.loadURL(this.blankUrl(id)).catch(() => {})
      return
    }
    const [tab] = this.tabs.splice(idx, 1)
    this.disposeTab(tab)
    if (this.activeId === id) this.selectTab(this.tabs[Math.max(0, idx - 1)].id)
    else this.emitState()
  }

  private disposeTab(tab: Tab) {
    const wc = tab.view.webContents
    ownerByWebContents.delete(wc.id)
    try { this.win.contentView.removeChildView(tab.view) } catch { /* window gone */ }
    if (!wc.isDestroyed()) wc.close()
  }

  tabList(): { id: string; title: string; url: string; active: boolean }[] {
    return this.state().tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.id === this.activeId }))
  }

  state(): BrowserState {
    const tabs = this.tabs.map((t) => {
      const wc = t.view.webContents
      const url = wc.getURL()
      const blank = url.startsWith('data:')
      return { id: t.id, url: blank ? '' : url, title: blank ? '' : wc.getTitle(), loading: wc.isLoading() }
    })
    const cur = tabs.find((t) => t.id === this.activeId) ?? tabs[0]
    const wc = this.active.view.webContents
    return {
      sessionId: this.sessionId,
      url: cur.url,
      title: cur.title,
      loading: cur.loading,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      tabs,
      activeTab: this.activeId,
      zoom: wc.getZoomFactor(),
    }
  }

  private emitState() {
    if (this.tabs.length === 0 || this.tabs.some((t) => t.view.webContents.isDestroyed())) return
    this.events.onState(this.state())
  }

  setBounds(b: Rect) {
    this.bounds = b
    if (this.visible) this.active.view.setBounds(b)
  }

  setVisible(v: boolean) {
    this.visible = v
    for (const t of this.tabs) t.view.setVisible(v && t.id === this.activeId)
    if (v) this.active.view.setBounds(this.bounds)
  }

  // ---- user-facing controls -------------------------------------------------

  private normalize(url: string) {
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  }

  navigate(url: string) {
    return this.view.webContents.loadURL(this.normalize(url))
  }
  back() { this.view.webContents.navigationHistory.goBack() }
  forward() { this.view.webContents.navigationHistory.goForward() }
  reload() { this.view.webContents.reload() }

  async openFile(path: string) {
    const abs = isAbsolute(path) ? path : resolve(this.cwd, path)
    const url = await toViewableUrl(abs)
    await this.view.webContents.loadURL(url)
  }

  find(text: string, forward: boolean, next: boolean) {
    if (!text) return this.stopFind()
    // Electron's `findNext` means the opposite of what it says: true starts a new search.
    this.view.webContents.findInPage(text, { forward, findNext: !next })
  }
  stopFind() { this.view.webContents.stopFindInPage('clearSelection') }

  setZoom(factor: number) {
    this.view.webContents.setZoomFactor(Math.min(3, Math.max(0.3, Math.round(factor * 10) / 10)))
    this.emitState()
  }

  async capture(): Promise<string> {
    return (await this.view.webContents.capturePage()).toPNG().toString('base64')
  }

  devTools() {
    const wc = this.view.webContents
    if (wc.isDevToolsOpened()) wc.closeDevTools()
    else wc.openDevTools({ mode: 'detach' })
  }

  // ---- Playwright access ----------------------------------------------------

  /** Resolve the Playwright Page of the active tab (matched by URL among pages no other tab claimed). */
  async getPage(): Promise<Page> {
    const tab = this.active
    if (tab.page && !tab.page.isClosed()) return tab.page
    const browser = await this.cdp()
    const wanted = tab.view.webContents.getURL()
    const claimed = new Set(this.tabs.filter((t) => t !== tab && t.page).map((t) => t.page))
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          if (p.url() === wanted && !claimed.has(p)) {
            tab.page = p
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
    for (const t of this.tabs.splice(0)) this.disposeTab(t)
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
  // Lets the "done" chime play even if the window has not been clicked yet.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${port}`)
}
