import { app, BrowserWindow, ipcMain, dialog, shell, Notification } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createServer } from 'node:net'
import { AgentManager } from './agent'
import { CdpConnection, enableRemoteDebugging } from './browser'
import { VIEWABLE_EXTENSIONS } from './documents'
import type { PermissionAnswer, PermissionMode, Rect, ImageAttachment } from '../shared/ipc'
import { readFileSync } from 'node:fs'

app.setName('aimux')
// Dev/test runs can use their own profile so they never touch a running instance's data.
if (process.env.AIMUX_USER_DATA) app.setPath('userData', process.env.AIMUX_USER_DATA)

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

// Playwright drives the embedded browser views over CDP on a free localhost port.
const cdpPort = await new Promise<number>((res, rej) => {
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
  onMessage: (sessionId, msg) => {
    win?.webContents.send('agent:message', sessionId, msg)
    if (msg.type === 'result' && win && !win.isFocused() && Notification.isSupported()) {
      const meta = agents.metaOf(sessionId)
      new Notification({ title: 'aimux', body: `${meta?.title ?? 'Claude'} · ${msg.is_error ? 'greška' : 'gotovo'}` })
        .on('click', () => { win?.show(); win?.focus() })
        .show()
    }
  },
  onMeta: (meta) => win?.webContents.send('agent:meta', meta),
  onPermission: (req) => {
    win?.webContents.send('agent:permission', req)
    if (process.env.AIMUX_AUTOANSWER) {
      setTimeout(() => agents.answerPermission(req.requestId, { behavior: process.env.AIMUX_AUTOANSWER === 'deny' ? 'deny' : 'allow' }),
        Number(process.env.AIMUX_AUTOANSWER_DELAY ?? 2500))
    }
  },
  onError: (sessionId, error) => win?.webContents.send('agent:error', sessionId, error),
}, cdp)

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'aimux',
    icon: join(import.meta.dirname, '../../build/icon.png'),
    frame: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
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

/** Dev aids: AIMUX_AUTOPROMPT sends a prompt on startup, AIMUX_SCREENSHOT captures the window to a PNG. */
function installDevHooks() {
  const prompt = process.env.AIMUX_AUTOPROMPT
  const autoOpen = process.env.AIMUX_AUTOOPEN
  let devSession: string | null = null
  if (prompt || autoOpen) {
    const meta = agents.createSession({ cwd: process.env.AIMUX_CWD ?? process.cwd(), permissionMode: 'default' })
    devSession = meta.id
    win?.webContents.send('agent:meta', meta)
    if (prompt) setTimeout(() => {
      const imgPath = process.env.AIMUX_AUTOIMAGE
      const images = imgPath ? [{ mediaType: 'image/png', data: readFileSync(imgPath).toString('base64') }] : []
      agents.send(meta.id, prompt, images)
    }, 300)
    if (autoOpen) setTimeout(() => {
      win?.webContents.send('browser:activity', meta.id)
      void agents.browserOf(meta.id).openFile(autoOpen)
    }, 800)
  }
  if (process.env.AIMUX_TOGGLE_SIDEBAR) {
    setTimeout(() => win?.webContents.send('dev:command', { type: 'toggleSidebar' }), Number(process.env.AIMUX_TOGGLE_SIDEBAR))
  }
  if (process.env.AIMUX_AUTOSPLIT) {
    win?.webContents.send('dev:command', { type: 'split', dir: process.env.AIMUX_AUTOSPLIT === 'vertical' ? 'vertical' : 'horizontal' })
  }
  if (process.env.AIMUX_AUTORESUME) {
    const cwd = process.env.AIMUX_CWD ?? process.cwd()
    setTimeout(() => void agents.listSessions(cwd).then((list) => {
      const target = process.env.AIMUX_AUTORESUME === 'latest' ? list[0]?.sessionId : process.env.AIMUX_AUTORESUME
      if (target) win?.webContents.send('dev:command', { type: 'resume', sdkSessionId: target, cwd })
    }), 800)
  }
  const shot = process.env.AIMUX_SCREENSHOT
  if (shot) {
    const delays = (process.env.AIMUX_SCREENSHOT_DELAY ?? '8000').split(',').map(Number)
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
          console.log('[aimux] screenshot ->', file)
          return
        } catch (err) {
          console.warn('[aimux] screenshot retry', attempt, String(err))
          await new Promise((r) => setTimeout(r, 400))
        }
      }
    }, delay))
  }
}

ipcMain.handle('session:create', (_e, opts: { cwd: string; resume?: string; permissionMode?: PermissionMode }) =>
  agents.createSession(opts))
ipcMain.handle('session:send', (_e, id: string, text: string, images?: ImageAttachment[]) => agents.send(id, text, images))
ipcMain.handle('session:interrupt', (_e, id: string) => agents.interrupt(id))
ipcMain.handle('session:setPermissionMode', (_e, id: string, mode: PermissionMode) => agents.setPermissionMode(id, mode))
ipcMain.handle('session:close', (_e, id: string) => agents.closeSession(id))
ipcMain.handle('session:list', (_e, cwd?: string) => agents.listSessions(cwd))
ipcMain.handle('session:history', (_e, sdkId: string, cwd?: string) => agents.getHistory(sdkId, cwd))
ipcMain.handle('session:setModel', (_e, id: string, model?: string) => agents.setModel(id, model))
ipcMain.handle('permission:answer', (_e, requestId: string, answer: PermissionAnswer) =>
  agents.answerPermission(requestId, answer))
ipcMain.handle('browser:setBounds', (_e, id: string, rect: Rect) => agents.browserOf(id).setBounds(rect))
ipcMain.handle('browser:setVisible', (_e, id: string, v: boolean) => agents.browserOf(id).setVisible(v))
ipcMain.handle('browser:navigate', (_e, id: string, url: string) => agents.browserOf(id).navigate(url).catch(() => {}))
ipcMain.handle('browser:back', (_e, id: string) => agents.browserOf(id).back())
ipcMain.handle('browser:forward', (_e, id: string) => agents.browserOf(id).forward())
ipcMain.handle('browser:reload', (_e, id: string) => agents.browserOf(id).reload())
ipcMain.handle('browser:getState', (_e, id: string) => agents.browserOf(id).state())
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

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  agents.closeAll()
  app.quit()
})
