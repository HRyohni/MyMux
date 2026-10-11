import { contextBridge, ipcRenderer } from 'electron'
import type { AimuxApi, SDKMessage, SessionMeta, PermissionRequest, BrowserState, DevCommand } from '../shared/ipc'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void) {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AimuxApi = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: (cb) => on<[boolean]>('window:maximized', cb),
  },
  browser: {
    setBounds: (id, rect) => ipcRenderer.invoke('browser:setBounds', id, rect),
    setVisible: (id, v) => ipcRenderer.invoke('browser:setVisible', id, v),
    navigate: (id, url) => ipcRenderer.invoke('browser:navigate', id, url),
    back: (id) => ipcRenderer.invoke('browser:back', id),
    forward: (id) => ipcRenderer.invoke('browser:forward', id),
    reload: (id) => ipcRenderer.invoke('browser:reload', id),
    openFile: (id, path) => ipcRenderer.invoke('browser:openFile', id, path),
    getState: (id) => ipcRenderer.invoke('browser:getState', id),
    onState: (cb) => on<[BrowserState]>('browser:state', cb),
    onActivity: (cb) => on<[string]>('browser:activity', cb),
  },
  createSession: (opts) => ipcRenderer.invoke('session:create', opts),
  send: (id, text, images) => ipcRenderer.invoke('session:send', id, text, images),
  interrupt: (id) => ipcRenderer.invoke('session:interrupt', id),
  setPermissionMode: (id, mode) => ipcRenderer.invoke('session:setPermissionMode', id, mode),
  closeSession: (id) => ipcRenderer.invoke('session:close', id),
  answerPermission: (requestId, answer) => ipcRenderer.invoke('permission:answer', requestId, answer),
  listSessions: (cwd) => ipcRenderer.invoke('session:list', cwd),
  getHistory: (sdkId, cwd) => ipcRenderer.invoke('session:history', sdkId, cwd),
  setModel: (id, model) => ipcRenderer.invoke('session:setModel', id, model),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  homeDir: () => ipcRenderer.invoke('os:homeDir'),
  onMessage: (cb) => on<[string, SDKMessage]>('agent:message', cb),
  onMeta: (cb) => on<[SessionMeta]>('agent:meta', cb),
  onPermission: (cb) => on<[PermissionRequest]>('agent:permission', cb),
  onError: (cb) => on<[string, string]>('agent:error', cb),
  onDevCommand: (cb) => on<[DevCommand]>('dev:command', cb),
}

contextBridge.exposeInMainWorld('aimux', api)
