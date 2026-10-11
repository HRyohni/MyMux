import { query, listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type {
  Query, SDKUserMessage, SDKMessage, PermissionMode, PermissionResult, CanUseTool, SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import type { PermissionAnswer, PermissionRequest, SessionMeta, BrowserState, HistoryMessage, ImageAttachment } from '../shared/ipc'
import { SessionBrowser, type CdpConnection } from './browser'
import { createBrowserTools } from './browserTools'
import type { BrowserWindow } from 'electron'

/** Push-based async iterable used as the SDK's streaming prompt input. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private waiters: Array<(r: IteratorResult<SDKUserMessage>) => void> = []
  private closed = false

  push(msg: SDKUserMessage) {
    if (this.closed) return
    const w = this.waiters.shift()
    if (w) w({ value: msg, done: false })
    else this.items.push(msg)
  }
  close() {
    this.closed = true
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true })
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((res) => this.waiters.push(res))
      },
    }
  }
}

function debugLog(msg: SDKMessage) {
  const m = msg as unknown as Record<string, unknown>
  const extra: string[] = []
  if ('subtype' in m) extra.push(`subtype=${String(m.subtype)}`)
  if (msg.type === 'user') {
    const c = (msg.message as { content: unknown }).content
    extra.push(`content=${typeof c === 'string' ? 'string' : Array.isArray(c) ? c.map((x) => (x as { type: string }).type).join(',') : typeof c}`)
    extra.push(`synthetic=${String(m.isSynthetic)} uuid=${'uuid' in m ? 'yes' : 'no'} replay=${String(m.tool_use_result !== undefined)}`)
  }
  if (msg.type === 'stream_event') extra.push(`event=${(msg.event as { type: string }).type}`)
  if (msg.type === 'assistant') extra.push(`blocks=${(msg.message as { content: Array<{ type: string }> }).content.map((b) => b.type).join(',')}`)
  console.log(`[sdk] ${msg.type} ${extra.join(' ')}`)
}

export interface AgentEvents {
  onMessage(sessionId: string, msg: SDKMessage): void
  onMeta(meta: SessionMeta): void
  onPermission(req: PermissionRequest): void
  onError(sessionId: string, error: string): void
  onBrowserState(state: BrowserState): void
  onBrowserActivity(sessionId: string): void
}

interface Session {
  meta: SessionMeta
  input: InputQueue
  q: Query
  abort: AbortController
  browser: SessionBrowser
}

export class AgentManager {
  private sessions = new Map<string, Session>()
  private pendingPermissions = new Map<string, (r: PermissionResult) => void>()
  private win: BrowserWindow | null = null

  constructor(private events: AgentEvents, private cdp: CdpConnection) {}

  attachWindow(win: BrowserWindow) { this.win = win }

  browserOf(sessionId: string): SessionBrowser { return this.must(sessionId).browser }

  createSession(opts: { cwd: string; resume?: string; permissionMode?: PermissionMode }): SessionMeta {
    if (!this.win) throw new Error('Prozor još nije spreman')
    const id = randomUUID()
    const input = new InputQueue()
    const abort = new AbortController()
    const browser = new SessionBrowser(id, opts.cwd, this.win, this.cdp.get, (st) => this.events.onBrowserState(st))
    const browserTools = createBrowserTools(browser, () => this.events.onBrowserActivity(id))
    const meta: SessionMeta = {
      id,
      sdkSessionId: opts.resume,
      cwd: opts.cwd,
      title: 'Novi razgovor',
      permissionMode: opts.permissionMode ?? 'default',
      running: false,
      createdAt: Date.now(),
    }

    const canUseTool: CanUseTool = (toolName, toolInput, options) => {
      // The app's own browser tools never need approval.
      if (toolName.startsWith('mcp__aimux__')) return Promise.resolve({ behavior: 'allow', updatedInput: toolInput })
      const requestId = randomUUID()
      return new Promise<PermissionResult>((resolve) => {
        this.pendingPermissions.set(requestId, resolve)
        options.signal.addEventListener('abort', () => {
          if (this.pendingPermissions.delete(requestId)) {
            resolve({ behavior: 'deny', message: 'Zahtjev prekinut' })
          }
        })
        this.events.onPermission({
          requestId, sessionId: id, toolName, input: toolInput,
          suggestions: options.suggestions, blockedPath: options.blockedPath,
        })
      })
    }

    const q = query({
      prompt: input,
      options: {
        cwd: opts.cwd,
        resume: opts.resume,
        permissionMode: meta.permissionMode,
        canUseTool,
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: {
          type: 'preset', preset: 'claude_code',
          append: 'Imaš browser panel koji korisnik vidi uživo u aplikaciji (alati mcp__aimux__browser_*). Koristi ga za web, PDF-ove i lokalne dokumente umjesto WebFetch-a kad korisnik želi nešto vidjeti.',
        },
        mcpServers: { aimux: browserTools },
        // Only unlocks the "Bez pitanja" mode so the user can switch to it; the mode itself stays the user's choice.
        allowDangerouslySkipPermissions: true,
        abortController: abort,
        stderr: (d) => console.error(`[claude ${id.slice(0, 8)}]`, d.trimEnd()),
      },
    })

    const session: Session = { meta, input, q, abort, browser }
    this.sessions.set(id, session)
    void this.pump(session)
    return meta
  }

  private async pump(s: Session) {
    try {
      for await (const msg of s.q) {
        if (process.env.AIMUX_DEBUG) debugLog(msg)
        this.handle(s, msg)
        this.events.onMessage(s.meta.id, msg)
      }
    } catch (err) {
      if (!s.abort.signal.aborted) {
        this.events.onError(s.meta.id, err instanceof Error ? err.message : String(err))
      }
    } finally {
      s.meta.running = false
      s.meta.ended = true
      this.events.onMeta({ ...s.meta })
    }
  }

  private handle(s: Session, msg: SDKMessage) {
    let changed = false
    if ('session_id' in msg && msg.session_id && s.meta.sdkSessionId !== msg.session_id) {
      s.meta.sdkSessionId = msg.session_id
      changed = true
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      s.meta.model = msg.model
      s.meta.permissionMode = msg.permissionMode
      changed = true
    }
    if (msg.type === 'result') {
      s.meta.running = false
      changed = true
    }
    if (changed) this.events.onMeta({ ...s.meta })
  }

  send(sessionId: string, text: string, images: ImageAttachment[] = []) {
    const s = this.must(sessionId)
    if (s.meta.title === 'Novi razgovor') {
      s.meta.title = text.replace(/\s+/g, ' ').slice(0, 60) || 'Slika'
    }
    const content: SDKUserMessage['message']['content'] = images.length === 0 ? text : [
      ...images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType as 'image/png', data: img.data },
      })),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ]
    s.meta.running = true
    this.events.onMeta({ ...s.meta })
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    }
    // The SDK does not echo prompts back, so the UI learns about them from here.
    this.events.onMessage(sessionId, msg)
    s.input.push(msg)
  }

  async interrupt(sessionId: string) {
    const s = this.must(sessionId)
    await s.q.interrupt()
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode) {
    const s = this.must(sessionId)
    await s.q.setPermissionMode(mode)
    s.meta.permissionMode = mode
    this.events.onMeta({ ...s.meta })
  }

  answerPermission(requestId: string, answer: PermissionAnswer) {
    const resolve = this.pendingPermissions.get(requestId)
    if (!resolve) return
    this.pendingPermissions.delete(requestId)
    if (answer.behavior === 'allow') {
      resolve({ behavior: 'allow', updatedPermissions: answer.updatedPermissions })
    } else {
      resolve({ behavior: 'deny', message: answer.message ?? 'Korisnik je odbio' })
    }
  }

  closeSession(sessionId: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return
    s.input.close()
    s.abort.abort()
    s.browser.destroy()
    this.sessions.delete(sessionId)
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.closeSession(id)
  }

  listSessions(cwd?: string): Promise<SDKSessionInfo[]> {
    return listSessions({ dir: cwd, limit: 40 })
  }

  async getHistory(sdkSessionId: string, cwd?: string): Promise<HistoryMessage[]> {
    const msgs = await getSessionMessages(sdkSessionId, { dir: cwd })
    return msgs.map((m) => ({ type: m.type, message: m.message, parent_tool_use_id: m.parent_tool_use_id }))
  }

  async setModel(sessionId: string, model?: string) {
    const s = this.must(sessionId)
    await s.q.setModel(model)
    s.meta.model = model ?? s.meta.model
    this.events.onMeta({ ...s.meta })
  }

  metaOf(sessionId: string): SessionMeta | undefined {
    return this.sessions.get(sessionId)?.meta
  }

  private must(id: string): Session {
    const s = this.sessions.get(id)
    if (!s) throw new Error(`Nepoznata sesija ${id}`)
    return s
  }
}
