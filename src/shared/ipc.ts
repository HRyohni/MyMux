// IPC contract shared between main, preload and renderer.
import type { SDKMessage, PermissionMode, PermissionUpdate, SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'

export type { SDKMessage, PermissionMode, PermissionUpdate, SDKSessionInfo }

export interface SessionMeta {
  id: string            // local id used by the UI
  sdkSessionId?: string // Claude session id once known
  cwd: string
  title: string
  model?: string
  permissionMode: PermissionMode
  running: boolean
  ended?: boolean   // SDK process finished; session must be resumed to continue
  createdAt: number
}

/** An image attached to a prompt: base64 payload without the data: prefix. */
export interface ImageAttachment { mediaType: string; data: string }

export interface HistoryMessage {
  type: 'user' | 'assistant' | 'system'
  message: unknown
  parent_tool_use_id: string | null
}

export interface PermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  blockedPath?: string
}

export type PermissionAnswer =
  | { behavior: 'allow'; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message?: string }

export interface Rect { x: number; y: number; width: number; height: number }

export interface BrowserState {
  sessionId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserApi {
  setBounds(sessionId: string, rect: Rect): Promise<void>
  setVisible(sessionId: string, visible: boolean): Promise<void>
  navigate(sessionId: string, url: string): Promise<void>
  back(sessionId: string): Promise<void>
  forward(sessionId: string): Promise<void>
  reload(sessionId: string): Promise<void>
  openFile(sessionId: string, path?: string): Promise<void>
  getState(sessionId: string): Promise<BrowserState | null>
  onState(cb: (state: BrowserState) => void): () => void
  onActivity(cb: (sessionId: string) => void): () => void
}

export interface WindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  onMaximized(cb: (maximized: boolean) => void): () => void
}

export interface AimuxApi {
  browser: BrowserApi
  window: WindowApi
  createSession(opts: { cwd: string; resume?: string; permissionMode?: PermissionMode }): Promise<SessionMeta>
  send(sessionId: string, text: string, images?: ImageAttachment[]): Promise<void>
  interrupt(sessionId: string): Promise<void>
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  closeSession(sessionId: string): Promise<void>
  answerPermission(requestId: string, answer: PermissionAnswer): Promise<void>
  listSessions(cwd?: string): Promise<SDKSessionInfo[]>
  getHistory(sdkSessionId: string, cwd?: string): Promise<HistoryMessage[]>
  setModel(sessionId: string, model?: string): Promise<void>
  pickFolder(): Promise<string | null>
  homeDir(): Promise<string>
  onMessage(cb: (sessionId: string, msg: SDKMessage) => void): () => void
  onMeta(cb: (meta: SessionMeta) => void): () => void
  onPermission(cb: (req: PermissionRequest) => void): () => void
  onError(cb: (sessionId: string, error: string) => void): () => void
  /** Dev-only commands driven by env vars (see README). */
  onDevCommand(cb: (cmd: DevCommand) => void): () => void
}

export type DevCommand =
  | { type: 'resume'; sdkSessionId: string; cwd: string }
  | { type: 'split'; dir: 'horizontal' | 'vertical' }
  | { type: 'toggleSidebar' }
