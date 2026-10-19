import { app, BrowserWindow, ipcMain, dialog, shell, Notification, session, Tray, Menu, nativeImage } from 'electron'
import { join, parse } from 'node:path'
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { createServer } from 'node:net'
import { AgentManager } from './agent'
import { CdpConnection, enableRemoteDebugging, sessionOfWebContents } from './browser'
import { searchFiles, saveTempFile } from './files'
import { initAutoUpdate } from './updater'
import { gitStatus, gitDiff, gitCommit, gitStash, gitWorktree } from './git'
import { listDir, searchTranscripts, getSubagentHistory, saveExport, editPermissionRule } from './extras'
import { VIEWABLE_EXTENSIONS, sourceOfViewableUrl } from './documents'
import { googleUrl } from '../shared/search'
import type {
  PermissionAnswer, PermissionMode, Rect, ImageAttachment, CreateSessionOptions, EffortLevel, ForkOptions, DownloadInfo,
  ElicitationAnswer, McpServerSpec,
} from '../shared/ipc'

app.setName('mymux')
// The app used to be called aimux: carry its profile (settings, layouts, favourites) over once.
const legacyProfile = join(app.getPath('appData'), 'aimux')
if (!process.env.MYMUX_USER_DATA && !existsSync(app.getPath('userData')) && existsSync(legacyProfile)) {
  try { cpSync(legacyProfile, app.getPath('userData'), { recursive: true }) } catch { /* start with a fresh profile */ }
}
// Dev/test runs can use their own profile so they never touch a running instance's data.
if (process.env.MYMUX_USER_DATA) app.setPath('userData', process.env.MYMUX_USER_DATA)

// Two instances sharing one profile crash each other's renderer, so a second launch
// just brings the running window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

let win: BrowserWindow | null = null
let tray: Tray | null = null

/** Shows the window and, when given, the session a notification was about. */
function reveal(sessionId?: string) {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (sessionId) win.webContents.send('app:showSession', sessionId)
}

/** Tells the user something needs them while the window is not in front. */
function notify(sessionId: string, body: string) {
  if (!win || win.isFocused() || !Notification.isSupported()) return
  new Notification({ title: 'mymux', body }).on('click', () => reveal(sessionId)).show()
}

// Playwright drives the embedded browser views over CDP on a free localhost port.
// MYMUX_CDP_PORT pins the port so a test script can attach to the UI.
const cdpPort = Number(process.env.MYMUX_CDP_PORT) || await new Promise<number>((res, rej) => {
  const srv = createServer()
  srv.listen(0, '127.0.0.1', () => {
    const addr = srv.address()
    srv.close(() => (typeof addr === 'object' && addr ? res(addr.port) : rej(new Error('no port'))))
  })
})
enableRemoteDebugging(cdpPort)
const cdp = new CdpConnection(cdpPort)

const agents = new AgentManager({
  onBrowserState: (state) => win?.webContents.send('browser:state', state),
  onBrowserActivity: (sessionId) => win?.webContents.send('browser:activity', sessionId),
  onBrowserFind: (result) => win?.webContents.send('browser:find', result),
  onBrowserShortcut: (sessionId, shortcut) => win?.webContents.send('browser:shortcut', sessionId, shortcut),
  onMessage: (sessionId, msg) => {
    win?.webContents.send('agent:message', sessionId, msg)
    if (msg.type === 'result') notify(sessionId, `${agents.metaOf(sessionId)?.title ?? 'Claude'} · ${msg.is_error ? 'greška' : 'gotovo'}`)
  },
  onMeta: (meta) => win?.webContents.send('agent:meta', meta),
  onPermission: (req) => {
    win?.webContents.send('agent:permission', req)
    const what = req.toolName === 'AskUserQuestion' ? 'ima pitanje' : req.toolName === 'ExitPlanMode' ? 'plan čeka pregled' : `čeka odobrenje (${req.toolName})`
    notify(req.sessionId, `${agents.metaOf(req.sessionId)?.title ?? 'Claude'} · ${what}`)
    if (process.env.MYMUX_AUTOANSWER) {
      setTimeout(() => agents.answerPermission(req.requestId, { behavior: process.env.MYMUX_AUTOANSWER === 'deny' ? 'deny' : 'allow' }),
        Number(process.env.MYMUX_AUTOANSWER_DELAY ?? 2500))
    }
  },
  onPermissionResolved: (sessionId, requestId) => win?.webContents.send('agent:permissionResolved', sessionId, requestId),
  onElicitation: (req) => {
    win?.webContents.send('agent:elicitation', req)
    notify(req.sessionId, `${agents.metaOf(req.sessionId)?.title ?? 'Claude'} · MCP server ${req.serverName} traži unos`)
  },
  onElicitationResolved: (sessionId, requestId) => win?.webContents.send('agent:elicitationResolved', sessionId, requestId),
  onError: (sessionId, error) => win?.webContents.send('agent:error', sessionId, error),
}, cdp)

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'mymux',
    icon: join(import.meta.dirname, '../../build/icon.png'),
    frame: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  agents.attachWindow(win)
  win.webContents.on('console-message', (ev) => {
    if (ev.level === 'error' || ev.level === 'warning') console.error(`[renderer ${ev.level}] ${ev.message} (${ev.sourceId}:${ev.lineNumber})`)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.error('[renderer gone]', d.reason))
  const sendMax = () => win?.webContents.send('window:maximized', win.isMaximized())
  win.on('maximize', sendMax)
  win.on('unmaximize', sendMax)
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
  win.webContents.on('did-finish-load', () => installDevHooks())
  win.on('closed', () => { win = null })
}

/** Tray icon: shows how many conversations wait or work, and brings the window back with a click. */
function installTray() {
  tray = new Tray(nativeImage.createFromPath(join(import.meta.dirname, '../../build/icon.png')).resize({ width: 16, height: 16 }))
  tray.setToolTip('mymux')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Prikaži mymux', click: () => reveal() },
    { type: 'separator' },
    { label: 'Zatvori', click: () => app.quit() },
  ]))
  tray.on('click', () => reveal())
}

/** Saves downloads from the browser panels straight to the Downloads folder and reports progress to the panel. */
function installDownloads() {
  session.defaultSession.on('will-download', (_e, item, wc) => {
    const dir = app.getPath('downloads')
    const { name, ext } = parse(item.getFilename())
    let path = join(dir, name + ext)
    for (let n = 1; existsSync(path); n++) path = join(dir, `${name} (${n})${ext}`)
    item.setSavePath(path)
    const id = randomUUID()
    const sessionId = (wc && sessionOfWebContents(wc.id)) ?? ''
    const report = (state: DownloadInfo['state']) => win?.webContents.send('browser:download', {
      id, sessionId, filename: parse(path).base, path, received: item.getReceivedBytes(), total: item.getTotalBytes(), state,
    } satisfies DownloadInfo)
    report('progressing')
    item.on('updated', (_ev, state) => report(state === 'interrupted' ? 'interrupted' : 'progressing'))
    item.once('done', (_ev, state) => report(state))
  })
}

/** Dev aids: MYMUX_AUTOPROMPT sends a prompt on startup, MYMUX_SCREENSHOT captures the window to a PNG. */
function installDevHooks() {
  const prompt = process.env.MYMUX_AUTOPROMPT
  const autoOpen = process.env.MYMUX_AUTOOPEN
  let devSession: string | null = null
  if (prompt || autoOpen) {
    const meta = agents.createSession({ cwd: process.env.MYMUX_CWD ?? process.cwd(), permissionMode: (process.env.MYMUX_MODE as PermissionMode | undefined) ?? 'default' })
    devSession = meta.id
    win?.webContents.send('agent:meta', meta)
    if (prompt) setTimeout(() => {
      const imgPath = process.env.MYMUX_AUTOIMAGE
      const images = imgPath ? [{ mediaType: 'image/png', data: readFileSync(imgPath).toString('base64') }] : []
      agents.send(meta.id, prompt, images)
    }, 300)
    if (autoOpen) setTimeout(() => {
      win?.webContents.send('browser:activity', meta.id)
      void agents.browserOf(meta.id).openFile(autoOpen)
    }, 800)
  }
  if (process.env.MYMUX_TOGGLE_SIDEBAR) {
    setTimeout(() => win?.webContents.send('dev:command', { type: 'toggleSidebar' }), Number(process.env.MYMUX_TOGGLE_SIDEBAR))
  }
  if (process.env.MYMUX_AUTOSPLIT) {
    win?.webContents.send('dev:command', { type: 'split', dir: process.env.MYMUX_AUTOSPLIT === 'vertical' ? 'vertical' : 'horizontal' })
  }
  if (process.env.MYMUX_AUTORESUME) {
    const cwd = process.env.MYMUX_CWD ?? process.cwd()
    setTimeout(() => void agents.listSessions(cwd).then((list) => {
      const target = process.env.MYMUX_AUTORESUME === 'latest' ? list[0]?.sessionId : process.env.MYMUX_AUTORESUME
      if (target) win?.webContents.send('dev:command', { type: 'resume', sdkSessionId: target, cwd })
    }), 800)
  }
  const shot = process.env.MYMUX_SCREENSHOT
  if (shot) {
    const delays = (process.env.MYMUX_SCREENSHOT_DELAY ?? '8000').split(',').map(Number)
    delays.forEach((delay, i) => setTimeout(async () => {
      const file = delays.length > 1 ? shot.replace(/\.png$/i, `-${i + 1}.png`) : shot
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          if (!win) return
          const img = await win.webContents.capturePage()
          writeFileSync(file, img.toPNG())
          if (devSession) {
            const v = await agents.browserOf(devSession).view.webContents.capturePage()
            writeFileSync(file.replace(/\.png$/i, '-browser.png'), v.toPNG())
          }
          console.log('[mymux] screenshot ->', file)
          return
        } catch (err) {
          console.warn('[mymux] screenshot retry', attempt, String(err))
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    }, delay))
  }
}

ipcMain.handle('session:create', (_e, opts: CreateSessionOptions) => agents.createSession(opts))
ipcMain.handle('session:send', (_e, id: string, text: string, images?: ImageAttachment[], now?: boolean) => agents.send(id, text, images, now))
ipcMain.handle('session:cancelQueued', (_e, id: string, msgId: string) => agents.cancelQueued(id, msgId))
ipcMain.handle('session:sendQueuedNow', (_e, id: string, msgId: string) => agents.sendQueuedNow(id, msgId))
ipcMain.handle('session:info', (_e, sdkId: string, cwd?: string) => agents.getSessionInfo(sdkId, cwd))
ipcMain.handle('session:setEffort', (_e, id: string, effort: EffortLevel | null) => agents.setEffort(id, effort))
ipcMain.handle('session:models', (_e, id: string) => agents.getModels(id))
ipcMain.handle('session:commands', (_e, id: string) => agents.getCommands(id))
ipcMain.handle('session:mcpStatus', (_e, id: string) => agents.getMcpStatus(id))
ipcMain.handle('session:mcpReconnect', (_e, id: string, name: string) => agents.reconnectMcp(id, name))
ipcMain.handle('session:mcpToggle', (_e, id: string, name: string, enabled: boolean) => agents.toggleMcp(id, name, enabled))
ipcMain.handle('session:rename', (_e, id: string, title: string) => agents.renameSession(id, title))
ipcMain.handle('session:fork', (_e, id: string, opts?: ForkOptions) => agents.fork(id, opts))
ipcMain.handle('session:rewindFiles', (_e, id: string, uuid: string, dryRun: boolean) => agents.rewindFiles(id, uuid, dryRun))
ipcMain.handle('stored:rename', (_e, sdkId: string, title: string, cwd?: string) => agents.renameStored(sdkId, title, cwd))
ipcMain.handle('stored:tag', (_e, sdkId: string, tag: string | null, cwd?: string) => agents.tagStored(sdkId, tag, cwd))
ipcMain.handle('stored:delete', (_e, sdkId: string, cwd?: string) => agents.deleteStored(sdkId, cwd))
ipcMain.handle('settings:info', (_e, cwd: string) => agents.getSettingsInfo(cwd))
ipcMain.handle('files:search', (_e, cwd: string, query: string) => searchFiles(cwd, query))
ipcMain.handle('files:saveTemp', (_e, name: string, base64: string) => saveTempFile(name, base64))
ipcMain.handle('session:interrupt', (_e, id: string) => agents.interrupt(id))
ipcMain.handle('session:setPermissionMode', (_e, id: string, mode: PermissionMode) => agents.setPermissionMode(id, mode))
ipcMain.handle('session:close', (_e, id: string) => agents.closeSession(id))
ipcMain.handle('session:list', (_e, cwd?: string) => agents.listSessions(cwd))
ipcMain.handle('session:history', (_e, sdkId: string, cwd?: string) => agents.getHistory(sdkId, cwd))
ipcMain.handle('session:setModel', (_e, id: string, model?: string) => agents.setModel(id, model))
ipcMain.handle('session:setRemoteControl', (_e, id: string, enabled: boolean) => agents.setRemoteControl(id, enabled))
ipcMain.handle('permission:answer', (_e, requestId: string, answer: PermissionAnswer) =>
  agents.answerPermission(requestId, answer))
ipcMain.handle('browser:setBounds', (_e, id: string, rect: Rect) => agents.browserIfOpen(id)?.setBounds(rect))
ipcMain.handle('browser:setVisible', (_e, id: string, v: boolean) => agents.browserIfOpen(id)?.setVisible(v))
ipcMain.handle('browser:navigate', (_e, id: string, url: string) => agents.browserOf(id).navigate(url).catch(() => {}))
ipcMain.handle('browser:back', (_e, id: string) => agents.browserOf(id).back())
ipcMain.handle('browser:forward', (_e, id: string) => agents.browserOf(id).forward())
ipcMain.handle('browser:reload', (_e, id: string) => agents.browserOf(id).reload())
ipcMain.handle('browser:getState', (_e, id: string) => agents.browserOf(id).state())
ipcMain.handle('browser:newTab', (_e, id: string, url?: string) => { agents.browserOf(id).newTab(url) })
ipcMain.handle('browser:closeTab', (_e, id: string, tabId: string) => agents.browserOf(id).closeTab(tabId))
ipcMain.handle('browser:selectTab', (_e, id: string, tabId: string) => agents.browserOf(id).selectTab(tabId))
ipcMain.handle('browser:find', (_e, id: string, text: string, forward: boolean, next: boolean) => agents.browserOf(id).find(text, forward, next))
ipcMain.handle('browser:stopFind', (_e, id: string) => agents.browserIfOpen(id)?.stopFind())
ipcMain.handle('browser:setZoom', (_e, id: string, factor: number) => agents.browserOf(id).setZoom(factor))
ipcMain.handle('browser:devTools', (_e, id: string) => agents.browserOf(id).devTools())
// The selection bubble of a browser-panel page (src/preload/page.ts).
ipcMain.on('page:selection', (e, action: unknown, text: unknown) => {
  const sessionId = sessionOfWebContents(e.sender.id)
  if (!sessionId || typeof text !== 'string' || !text.trim()) return
  const browser = agents.browserIfOpen(sessionId)
  if (action === 'google') browser?.newTab(googleUrl(text))
  else if (action === 'ask') {
    const url = e.sender.getURL()
    win?.webContents.send('browser:ask', sessionId, text.slice(0, 20000), e.sender.getTitle(), sourceOfViewableUrl(url) ?? url)
  }
})
ipcMain.handle('browser:openPath', async (_e, path: string) => { await shell.openPath(path) })
ipcMain.handle('browser:showInFolder', (_e, path: string) => shell.showItemInFolder(path))
ipcMain.handle('browser:openFile', async (_e, id: string, path?: string) => {
  let file = path
  if (!file && win) {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Dokumenti', extensions: VIEWABLE_EXTENSIONS }, { name: 'Sve', extensions: ['*'] }],
    })
    if (r.canceled) return
    file = r.filePaths[0]
  }
  if (file) await agents.browserOf(id).openFile(file).catch(() => {})
})
ipcMain.handle('dialog:pickFolder', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('os:homeDir', () => homedir())
ipcMain.handle('window:minimize', () => win?.minimize())
ipcMain.handle('window:toggleMaximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize() })
ipcMain.handle('window:close', () => win?.close())
ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)
ipcMain.handle('window:setActivity', (_e, waiting: number, running: number) => {
  const parts = [waiting ? `${waiting} čeka tebe` : '', running ? `${running} radi` : ''].filter(Boolean)
  tray?.setToolTip(parts.length ? `mymux · ${parts.join(' · ')}` : 'mymux')
  // The taskbar button flashes while something waits and the window is in the background.
  if (win && !win.isFocused()) win.flashFrame(waiting > 0)
})
ipcMain.handle('session:stopTask', (_e, id: string, taskId: string) => agents.stopTask(id, taskId))
ipcMain.handle('session:setThinking', (_e, id: string, enabled: boolean) => agents.setThinking(id, enabled))
ipcMain.handle('session:setFastMode', (_e, id: string, enabled: boolean) => agents.setFastMode(id, enabled))
ipcMain.handle('session:setMcpServers', (_e, id: string, servers: Record<string, McpServerSpec>) => agents.setMcpServers(id, servers))
ipcMain.handle('session:usage', (_e, id: string) => agents.getUsage(id))
ipcMain.handle('elicitation:answer', (_e, requestId: string, answer: ElicitationAnswer) => agents.answerElicitation(requestId, answer))
ipcMain.handle('settings:editRule', (_e, cwd: string, path: string, list: 'allow' | 'ask' | 'deny', rule: string, add: boolean) =>
  editPermissionRule(cwd, path, list, rule, add))
ipcMain.handle('stored:subagents', (_e, sdkId: string, cwd: string | undefined, agentIds: string[]) => getSubagentHistory(sdkId, cwd, agentIds))
ipcMain.handle('stored:search', (_e, query: string, cwd?: string) => searchTranscripts(query, cwd))
ipcMain.handle('files:list', (_e, cwd: string, rel: string) => listDir(cwd, rel))
ipcMain.handle('files:export', (_e, name: string, markdown: string) => (win ? saveExport(win, name, markdown) : null))
ipcMain.handle('git:status', (_e, cwd: string) => gitStatus(cwd))
ipcMain.handle('git:diff', (_e, cwd: string, path: string) => gitDiff(cwd, path))
ipcMain.handle('git:commit', (_e, cwd: string, message: string) => gitCommit(cwd, message))
ipcMain.handle('git:stash', (_e, cwd: string) => gitStash(cwd))
ipcMain.handle('git:worktree', (_e, cwd: string, branch: string) => gitWorktree(cwd, branch))
ipcMain.handle('browser:capture', (_e, id: string) => agents.browserOf(id).capture())
ipcMain.handle('window:setZoom', (_e, factor: number) => win?.webContents.setZoomFactor(Math.min(2, Math.max(0.5, factor))))

app.whenReady().then(() => {
  installDownloads()
  installTray()
  createWindow()
  initAutoUpdate()
})
app.on('window-all-closed', () => {
  agents.closeAll()
  app.quit()
})
