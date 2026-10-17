// IPC contract shared between main, preload and renderer.
import type { SDKMessage, PermissionMode, PermissionUpdate, SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'

export type { SDKMessage, PermissionMode, PermissionUpdate, SDKSessionInfo }

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A message waiting for the current turn to finish (preview only, the payload stays in main). */
export interface QueuedMessage { id: string; text: string; images: number }

export interface ContextInfo { tokens: number; max: number; percentage: number }

/** A background agent, shell or workflow the session is still running. */
export interface BackgroundTask { id: string; type: string; description: string }

export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  type?: string
  /** 0..1 share of the limit used, when the API reports it. */
  utilization?: number
  /** Unix seconds. */
  resetsAt?: number
}

/** An MCP server added in the app's own settings (on top of the ones Claude Code already has). */
export type McpServerSpec =
  | { type: 'stdio'; command: string; args: string[] }
  | { type: 'http' | 'sse'; url: string }

export interface SessionMeta {
  id: string            // local id used by the UI
  sdkSessionId?: string // Claude session id once known
  cwd: string
  title: string
  model?: string
  effort?: EffortLevel
  permissionMode: PermissionMode
  running: boolean
  ended?: boolean   // SDK process finished; session must be resumed to continue
  remoteUrl?: string // claude.ai link while Remote Control is on
  compacting?: boolean
  /** What Claude expects the user to say next, offered as a one-click prompt. */
  suggestion?: string
  tasks?: BackgroundTask[]
  rateLimit?: RateLimitInfo
  thinkingOff?: boolean
  fastMode?: boolean
  context?: ContextInfo
  costUsd?: number  // running total for the session
  queued?: QueuedMessage[]
  createdAt: number
}

export interface CreateSessionOptions {
  cwd: string
  resume?: string
  permissionMode?: PermissionMode
  model?: string
  effort?: EffortLevel
  title?: string
  mcpServers?: Record<string, McpServerSpec>
}

/** An MCP server asking the user for input (a form) or to finish a step in the browser (a URL). */
export interface ElicitationRequest {
  requestId: string
  sessionId: string
  serverName: string
  message: string
  mode: 'form' | 'url'
  url?: string
  /** JSON schema of the form; only flat objects of primitive fields are rendered. */
  schema?: Record<string, unknown>
}

export type ElicitationValue = string | number | boolean | string[]
export type ElicitationAnswer = { action: 'accept'; content?: Record<string, ElicitationValue> } | { action: 'decline' | 'cancel' }

export interface GitFile { path: string; status: string; added: number; removed: number }
export interface GitStatus { branch: string; upstream?: string; ahead: number; behind: number; files: GitFile[] }

export interface DirEntry { name: string; dir: boolean }

export interface TranscriptHit { sessionId: string; cwd?: string; title: string; snippet: string; lastModified: number }

export interface UsageLimit { label: string; percent: number; resetsAt: string | null }
export interface UsageInfo {
  email?: string
  organization?: string
  subscription?: string
  limits: UsageLimit[]
  extra?: { used: number | null; limit: number | null; currency?: string | null }
  linesAdded: number
  linesRemoved: number
}

/** An image attached to a prompt: base64 payload without the data: prefix. */
export interface ImageAttachment { mediaType: string; data: string }

export interface HistoryMessage {
  type: 'user' | 'assistant' | 'system'
  uuid?: string
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
  | { behavior: 'allow'; updatedPermissions?: PermissionUpdate[]; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string }

export interface Rect { x: number; y: number; width: number; height: number }

export interface BrowserTab { id: string; title: string; url: string; loading: boolean }

export interface BrowserState {
  sessionId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  tabs: BrowserTab[]
  activeTab: string
  zoom: number
}

export interface DownloadInfo {
  id: string
  sessionId: string
  filename: string
  path: string
  received: number
  total: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
}

export interface FindResult { sessionId: string; matches: number; active: number }

export type BrowserShortcut = 'find' | 'newTab' | 'closeTab'

export interface BrowserApi {
  setBounds(sessionId: string, rect: Rect): Promise<void>
  setVisible(sessionId: string, visible: boolean): Promise<void>
  navigate(sessionId: string, url: string): Promise<void>
  back(sessionId: string): Promise<void>
  forward(sessionId: string): Promise<void>
  reload(sessionId: string): Promise<void>
  openFile(sessionId: string, path?: string): Promise<void>
  getState(sessionId: string): Promise<BrowserState | null>
  newTab(sessionId: string, url?: string): Promise<void>
  closeTab(sessionId: string, tabId: string): Promise<void>
  selectTab(sessionId: string, tabId: string): Promise<void>
  /** Starts or continues a find-in-page; results arrive through onFind. */
  find(sessionId: string, text: string, forward: boolean, next: boolean): Promise<void>
  stopFind(sessionId: string): Promise<void>
  setZoom(sessionId: string, factor: number): Promise<void>
  devTools(sessionId: string): Promise<void>
  /** PNG of what the active tab shows, as base64. */
  capture(sessionId: string): Promise<string>
  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  onState(cb: (state: BrowserState) => void): () => void
  onActivity(cb: (sessionId: string) => void): () => void
  onDownload(cb: (d: DownloadInfo) => void): () => void
  onFind(cb: (r: FindResult) => void): () => void
  /** Keyboard shortcuts pressed while the embedded page has focus. */
  onShortcut(cb: (sessionId: string, shortcut: BrowserShortcut) => void): () => void
}

export interface WindowApi {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
  setZoom(factor: number): Promise<void>
  /** Sessions waiting for the user and sessions working, shown on the tray icon. */
  setActivity(waiting: number, running: number): Promise<void>
  onMaximized(cb: (maximized: boolean) => void): () => void
}

export interface SlashCommandInfo { name: string; description: string; argumentHint: string }

export interface ModelOption {
  value: string
  /** Full model id the alias stands for, as sessions report it. */
  resolved?: string
  label: string
  description?: string
  efforts?: EffortLevel[]
}

export interface McpServerInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string
  scope?: string
  version?: string
  url?: string
  tools: string[]
}

export interface HookInfo { event: string; matcher?: string; command: string }

/** Permission rules and hooks contributed by one settings file. */
export interface SettingsSourceInfo {
  source: string
  path?: string
  allow: string[]
  deny: string[]
  ask: string[]
  defaultMode?: string
  hooks: HookInfo[]
}

export interface RewindResult {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

export interface ForkOptions {
  /** Copy the conversation up to, but not including, this user message. */
  beforeUuid?: string
  /** Text of that message, used to find it when the transcript does not carry our uuid. */
  beforeText?: string
  title?: string
}

export interface MymuxApi {
  browser: BrowserApi
  window: WindowApi
  createSession(opts: CreateSessionOptions): Promise<SessionMeta>
  /** While a turn is running the message is queued unless `now` is set. */
  send(sessionId: string, text: string, images?: ImageAttachment[], now?: boolean): Promise<void>
  cancelQueued(sessionId: string, id: string): Promise<void>
  sendQueuedNow(sessionId: string, id: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>
  closeSession(sessionId: string): Promise<void>
  answerPermission(requestId: string, answer: PermissionAnswer): Promise<void>
  listSessions(cwd?: string): Promise<SDKSessionInfo[]>
  getHistory(sdkSessionId: string, cwd?: string): Promise<HistoryMessage[]>
  getSessionInfo(sdkSessionId: string, cwd?: string): Promise<SDKSessionInfo | null>
  setModel(sessionId: string, model?: string): Promise<void>
  setEffort(sessionId: string, effort: EffortLevel | null): Promise<void>
  getModels(sessionId: string): Promise<ModelOption[]>
  getCommands(sessionId: string): Promise<SlashCommandInfo[]>
  getMcpStatus(sessionId: string): Promise<McpServerInfo[]>
  reconnectMcp(sessionId: string, name: string): Promise<void>
  toggleMcp(sessionId: string, name: string, enabled: boolean): Promise<void>
  getSettingsInfo(cwd: string): Promise<SettingsSourceInfo[]>
  /** Renames an open session (and its transcript once it exists). */
  renameSession(sessionId: string, title: string): Promise<void>
  renameStored(sdkSessionId: string, title: string, cwd?: string): Promise<void>
  /** Sets or clears the transcript tag; "archived" hides the session from the list. */
  tagStored(sdkSessionId: string, tag: string | null, cwd?: string): Promise<void>
  deleteStored(sdkSessionId: string, cwd?: string): Promise<void>
  /** Copies the conversation into a new transcript; null means there was nothing before the message. */
  fork(sessionId: string, opts?: ForkOptions): Promise<{ sdkSessionId: string | null }>
  rewindFiles(sessionId: string, userMessageUuid: string, dryRun: boolean): Promise<RewindResult>
  searchFiles(cwd: string, query: string): Promise<string[]>
  listDir(cwd: string, rel: string): Promise<DirEntry[]>
  stopTask(sessionId: string, taskId: string): Promise<void>
  setThinking(sessionId: string, enabled: boolean): Promise<void>
  setFastMode(sessionId: string, enabled: boolean): Promise<void>
  /** Replaces the app-added MCP servers of a live session. */
  setMcpServers(sessionId: string, servers: Record<string, McpServerSpec>): Promise<void>
  answerElicitation(requestId: string, answer: ElicitationAnswer): Promise<void>
  getUsage(sessionId: string): Promise<UsageInfo>
  /** Adds or removes one rule in the permissions.allow/ask/deny list of a settings file. */
  editPermissionRule(cwd: string, path: string, list: 'allow' | 'ask' | 'deny', rule: string, add: boolean): Promise<void>
  /** Transcripts of the subagents a stored session started, keyed by agent id. */
  getSubagentHistory(sdkSessionId: string, cwd: string | undefined, agentIds: string[]): Promise<Record<string, HistoryMessage[]>>
  searchTranscripts(query: string, cwd?: string): Promise<TranscriptHit[]>
  /** Asks where to save and writes the conversation (.md, or .html rendered from it). Resolves to the path or null. */
  saveExport(defaultName: string, markdown: string): Promise<string | null>
  gitStatus(cwd: string): Promise<GitStatus | null>
  gitDiff(cwd: string, path: string): Promise<string>
  gitCommit(cwd: string, message: string): Promise<string>
  gitStash(cwd: string): Promise<string>
  /** Creates a worktree on a new branch next to the repository and resolves to its path. */
  gitWorktree(cwd: string, branch: string): Promise<string>
  /** Stores a pasted/dropped blob that has no path on disk and returns where it was written. */
  saveTempFile(name: string, base64: string): Promise<string>
  /** Absolute path of a dropped or picked file, empty when it has none. */
  pathForFile(file: File): string
  /** Resolves to the claude.ai link when enabled, null when disabled. */
  setRemoteControl(sessionId: string, enabled: boolean): Promise<string | null>
  pickFolder(): Promise<string | null>
  homeDir(): Promise<string>
  onMessage(cb: (sessionId: string, msg: SDKMessage) => void): () => void
  onMeta(cb: (meta: SessionMeta) => void): () => void
  onPermission(cb: (req: PermissionRequest) => void): () => void
  /** A request was answered or cancelled outside the card (turn interrupted, dev auto-answer). */
  onPermissionResolved(cb: (sessionId: string, requestId: string) => void): () => void
  onElicitation(cb: (req: ElicitationRequest) => void): () => void
  onElicitationResolved(cb: (sessionId: string, requestId: string) => void): () => void
  /** The tray icon or a notification asked to bring a session into view. */
  onShowSession(cb: (sessionId: string) => void): () => void
  onError(cb: (sessionId: string, error: string) => void): () => void
  /** Dev-only commands driven by env vars (see README). */
  onDevCommand(cb: (cmd: DevCommand) => void): () => void
}

export type DevCommand =
  | { type: 'resume'; sdkSessionId: string; cwd: string }
  | { type: 'split'; dir: 'horizontal' | 'vertical' }
  | { type: 'toggleSidebar' }
