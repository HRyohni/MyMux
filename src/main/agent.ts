import {
  query, listSessions, getSessionMessages, getSessionInfo, renameSession, tagSession, deleteSession, forkSession,
  resolveSettings,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  Query, SDKUserMessage, SDKMessage, PermissionMode, PermissionResult, CanUseTool, SDKSessionInfo,
} from '@anthropic-ai/claude-agent-sdk'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type {
  PermissionAnswer, PermissionRequest, SessionMeta, BrowserState, HistoryMessage, ImageAttachment, CreateSessionOptions,
  EffortLevel, ModelOption, SlashCommandInfo, McpServerInfo, SettingsSourceInfo, HookInfo, RewindResult, ForkOptions,
  FindResult, BrowserShortcut, ElicitationRequest, ElicitationAnswer, McpServerSpec, UsageInfo,
} from '../shared/ipc'
import { SessionBrowser, type CdpConnection } from './browser'
import { createBrowserTools } from './browserTools'
import { settingsPaths } from './extras'
import type { BrowserWindow } from 'electron'

const DEFAULT_TITLE = 'Novi razgovor'

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
  onPermissionResolved(sessionId: string, requestId: string): void
  onElicitation(req: ElicitationRequest): void
  onElicitationResolved(sessionId: string, requestId: string): void
  onError(sessionId: string, error: string): void
  onBrowserState(state: BrowserState): void
  onBrowserActivity(sessionId: string): void
  onBrowserFind(result: FindResult): void
  onBrowserShortcut(sessionId: string, shortcut: BrowserShortcut): void
}

interface Queued { id: string; text: string; images: ImageAttachment[] }

interface Session {
  meta: SessionMeta
  input: InputQueue
  q: Query
  abort: AbortController
  browser: SessionBrowser
  queue: Queued[]
  /** The user pressed stop: leave queued messages alone instead of sending the next one. */
  interrupted: boolean
  /** The title was set by the user, so the first prompt must not replace it. */
  customTitle: boolean
  /** The in-process server with the browser and session tools; kept so app-added servers can be swapped around it. */
  ownTools: ReturnType<typeof createBrowserTools>
}

interface PendingElicitation { resolve: (r: ElicitationAnswer | null) => void; sessionId: string }

function toMcpConfig(servers: Record<string, McpServerSpec> = {}) {
  return Object.fromEntries(Object.entries(servers)
    .filter(([name]) => name !== 'aimux')
    .map(([name, s]) => [name, s.type === 'stdio' ? { type: 'stdio' as const, command: s.command, args: s.args } : { type: s.type, url: s.url }]))
}

interface PendingPermission { resolve: (r: PermissionResult) => void; input: Record<string, unknown>; sessionId: string }

function promptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => (b as { type?: string }).type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('\n')
}

export class AgentManager {
  private sessions = new Map<string, Session>()
  private pendingPermissions = new Map<string, PendingPermission>()
  private pendingElicitations = new Map<string, PendingElicitation>()
  private win: BrowserWindow | null = null

  constructor(private events: AgentEvents, private cdp: CdpConnection) {}

  attachWindow(win: BrowserWindow) { this.win = win }

  browserOf(sessionId: string): SessionBrowser { return this.must(sessionId).browser }

  /** For calls that may arrive after the session was closed (a panel unmounting). */
  browserIfOpen(sessionId: string): SessionBrowser | undefined { return this.sessions.get(sessionId)?.browser }

  createSession(opts: CreateSessionOptions): SessionMeta {
    if (!this.win) throw new Error('Prozor još nije spreman')
    const id = randomUUID()
    const input = new InputQueue()
    const abort = new AbortController()
    const browser = new SessionBrowser(id, opts.cwd, this.win, this.cdp.get, {
      onState: (st) => this.events.onBrowserState(st),
      onFind: (r) => this.events.onBrowserFind(r),
      onShortcut: (sc) => this.events.onBrowserShortcut(id, sc),
    })
    const browserTools = createBrowserTools(browser, () => this.events.onBrowserActivity(id), this.sessionTools(id))
    const meta: SessionMeta = {
      id,
      sdkSessionId: opts.resume,
      cwd: opts.cwd,
      title: opts.title?.trim() || DEFAULT_TITLE,
      model: opts.model || undefined,
      effort: opts.effort,
      permissionMode: opts.permissionMode ?? 'default',
      running: false,
      createdAt: Date.now(),
    }

    const canUseTool: CanUseTool = (toolName, toolInput, options) => {
      // The app's own browser tools never need approval; sending work to another session does.
      if (toolName.startsWith('mcp__aimux__') && toolName !== 'mcp__aimux__session_send') {
        return Promise.resolve({ behavior: 'allow', updatedInput: toolInput })
      }
      const requestId = randomUUID()
      return new Promise<PermissionResult>((resolve) => {
        this.pendingPermissions.set(requestId, { resolve, input: toolInput, sessionId: id })
        options.signal.addEventListener('abort', () => {
          if (this.pendingPermissions.delete(requestId)) {
            resolve({ behavior: 'deny', message: 'Zahtjev prekinut' })
            this.events.onPermissionResolved(id, requestId)
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
        model: opts.model || undefined,
        effort: opts.effort,
        canUseTool,
        onElicitation: (req, o) => new Promise<ElicitationAnswer | null>((resolve) => {
          this.pendingElicitations.set(o.requestId, { resolve, sessionId: id })
          o.signal.addEventListener('abort', () => {
            if (this.pendingElicitations.delete(o.requestId)) {
              resolve(null)
              this.events.onElicitationResolved(id, o.requestId)
            }
          })
          this.events.onElicitation({
            requestId: o.requestId, sessionId: id, serverName: req.serverName, message: req.message,
            mode: req.mode === 'url' ? 'url' : 'form', url: req.url, schema: req.requestedSchema,
          })
        }),
        includePartialMessages: true,
        promptSuggestions: true,
        // Hook failures are shown in the conversation.
        includeHookEvents: true,
        // The UI stops background tasks one by one, so Stop only ends the current turn.
        perTaskStopAffordance: true,
        // Lets "Vrati datoteke" restore files to their state at an earlier prompt.
        enableFileCheckpointing: true,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: {
          type: 'preset', preset: 'claude_code',
          append: 'Imaš browser panel koji korisnik vidi uživo u aplikaciji (alati mcp__aimux__browser_*). Koristi ga za web, PDF-ove i lokalne dokumente umjesto WebFetch-a kad korisnik želi nešto vidjeti. '
            + 'U aplikaciji mogu biti otvoreni i drugi razgovori s Claudeom: mcp__aimux__session_list ih nabraja, a mcp__aimux__session_send im šalje poruku (korisnik to odobrava). Koristi ih samo kad korisnik traži suradnju između razgovora.',
        },
        mcpServers: { ...toMcpConfig(opts.mcpServers), aimux: browserTools },
        // Only unlocks the "Bez pitanja" mode so the user can switch to it; the mode itself stays the user's choice.
        allowDangerouslySkipPermissions: true,
        abortController: abort,
        stderr: (d) => console.error(`[claude ${id.slice(0, 8)}]`, d.trimEnd()),
      },
    })

    const session: Session = { meta, input, q, abort, browser, queue: [], interrupted: false, customTitle: false, ownTools: browserTools }
    this.sessions.set(id, session)
    void this.pump(session)
    return meta
  }

  private emitMeta(s: Session) { this.events.onMeta({ ...s.meta }) }

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
      s.meta.compacting = false
      s.meta.remoteUrl = undefined
      // A session the user closed is already gone from the UI; reporting it would bring it back.
      if (this.sessions.has(s.meta.id)) this.emitMeta(s)
    }
  }

  private handle(s: Session, msg: SDKMessage) {
    let changed = false
    if ('session_id' in msg && msg.session_id && s.meta.sdkSessionId !== msg.session_id) {
      s.meta.sdkSessionId = msg.session_id
      changed = true
      // A title chosen before the transcript existed could not be stored until now.
      if (s.customTitle) void renameSession(msg.session_id, s.meta.title, { dir: s.meta.cwd }).catch(() => {})
    }
    if (msg.type === 'system' && msg.subtype === 'init') {
      s.meta.model = msg.model
      s.meta.permissionMode = msg.permissionMode
      if (msg.effort) s.meta.effort = msg.effort
      if (msg.fast_mode_state) s.meta.fastMode = msg.fast_mode_state !== 'off'
      changed = true
    }
    if (msg.type === 'prompt_suggestion') {
      s.meta.suggestion = msg.suggestion
      changed = true
    }
    if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') {
      s.meta.tasks = msg.tasks.filter((t) => !t.ambient).map((t) => ({ id: t.task_id, type: t.subagent_type ?? t.task_type, description: t.description }))
      changed = true
    }
    if (msg.type === 'rate_limit_event') {
      const r = msg.rate_limit_info
      s.meta.rateLimit = { status: r.status, type: r.rateLimitType, utilization: r.utilization, resetsAt: r.resetsAt }
      changed = true
    }
    if (msg.type === 'system' && msg.subtype === 'status') {
      if (msg.permissionMode) s.meta.permissionMode = msg.permissionMode
      s.meta.compacting = msg.status === 'compacting'
      changed = true
    }
    if (msg.type === 'result') {
      s.meta.costUsd = msg.total_cost_usd
      // A message steered in mid-turn gets a turn of its own; the session is not idle yet.
      const more = 'queued_turn_count' in msg && (msg.queued_turn_count ?? 0) > 0
      if (!more) {
        s.meta.running = false
        const next = s.interrupted ? undefined : s.queue.shift()
        s.interrupted = false
        if (next) {
          this.syncQueue(s)
          setImmediate(() => { if (this.sessions.has(s.meta.id)) this.dispatch(s, next.text, next.images) })
        }
      }
      changed = true
      void this.refreshContext(s)
    }
    if (changed) this.emitMeta(s)
  }

  private async refreshContext(s: Session) {
    try {
      const u = await s.q.getContextUsage()
      const max = u.rawMaxTokens || u.maxTokens
      if (!max) return
      s.meta.context = { tokens: u.totalTokens, max, percentage: Math.round((u.totalTokens / max) * 100) }
      this.emitMeta(s)
    } catch { /* older CLI or the session ended */ }
  }

  private syncQueue(s: Session) {
    s.meta.queued = s.queue.map((m) => ({ id: m.id, text: m.text.slice(0, 200), images: m.images.length }))
  }

  send(sessionId: string, text: string, images: ImageAttachment[] = [], now = false) {
    const s = this.must(sessionId)
    if (s.meta.running && !now) {
      s.queue.push({ id: randomUUID(), text, images })
      this.syncQueue(s)
      this.emitMeta(s)
      return
    }
    this.dispatch(s, text, images)
  }

  private dispatch(s: Session, text: string, images: ImageAttachment[]) {
    if (s.meta.title === DEFAULT_TITLE && !s.customTitle && !text.startsWith('/')) {
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
    s.meta.suggestion = undefined
    this.emitMeta(s)
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      // Our own uuid lets the UI address this prompt later (fork, rewind).
      uuid: randomUUID(),
    }
    // The SDK does not echo prompts back, so the UI learns about them from here.
    this.events.onMessage(s.meta.id, msg)
    s.input.push(msg)
  }

  cancelQueued(sessionId: string, id: string) {
    const s = this.must(sessionId)
    s.queue = s.queue.filter((m) => m.id !== id)
    this.syncQueue(s)
    this.emitMeta(s)
  }

  /** Sends a queued message right away; mid-turn it reaches Claude between tool calls. */
  sendQueuedNow(sessionId: string, id: string) {
    const s = this.must(sessionId)
    const m = s.queue.find((x) => x.id === id)
    if (!m) return
    s.queue = s.queue.filter((x) => x.id !== id)
    this.syncQueue(s)
    this.dispatch(s, m.text, m.images)
  }

  async interrupt(sessionId: string) {
    const s = this.must(sessionId)
    s.interrupted = true
    await s.q.interrupt()
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode) {
    const s = this.must(sessionId)
    await s.q.setPermissionMode(mode)
    s.meta.permissionMode = mode
    this.emitMeta(s)
  }

  answerPermission(requestId: string, answer: PermissionAnswer) {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending) return
    this.pendingPermissions.delete(requestId)
    this.events.onPermissionResolved(pending.sessionId, requestId)
    if (answer.behavior === 'allow') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: answer.updatedInput ?? pending.input,
        updatedPermissions: answer.updatedPermissions,
      })
    } else {
      pending.resolve({ behavior: 'deny', message: answer.message?.trim() || 'Korisnik je odbio' })
    }
  }

  answerElicitation(requestId: string, answer: ElicitationAnswer) {
    const pending = this.pendingElicitations.get(requestId)
    if (!pending) return
    this.pendingElicitations.delete(requestId)
    this.events.onElicitationResolved(pending.sessionId, requestId)
    pending.resolve(answer)
  }

  /**
   * Tools that let one conversation hand work to another one open in the app.
   * Listing is free; sending goes through the normal permission prompt.
   */
  private sessionTools(selfId: string) {
    const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
    return [
      tool('session_list', 'Popis drugih razgovora otvorenih u aplikaciji: id, naslov, radna mapa i stanje.', {},
        async () => {
          const rows = [...this.sessions.values()].filter((s) => s.meta.id !== selfId && !s.meta.ended)
            .map((s) => `[${s.meta.id}] "${s.meta.title}" · ${s.meta.cwd} · ${s.meta.running ? 'radi' : 'slobodan'}`)
          return text(rows.length ? rows.join('\n') : 'Nema drugih otvorenih razgovora.')
        }),
      tool('session_send', 'Pošalji poruku drugom razgovoru (id iz session_list). Ako taj razgovor trenutno radi, poruka čeka u njegovom redu. Odgovor ne stiže automatski: zamoli primatelja da ti odgovori istim alatom ako ga trebaš.',
        { id: z.string(), message: z.string().min(1) },
        async (a) => {
          const target = this.sessions.get(a.id)
          const self = this.sessions.get(selfId)
          if (!target || target.meta.ended || a.id === selfId) return text('Razgovor s tim id-em nije otvoren.')
          this.send(a.id, `[Poruka iz razgovora "${self?.meta.title ?? selfId}", id ${selfId}]\n\n${a.message}`)
          return text(`Poslano razgovoru "${target.meta.title}".`)
        }),
    ]
  }

  async stopTask(sessionId: string, taskId: string) { await this.must(sessionId).q.stopTask(taskId) }

  async setThinking(sessionId: string, enabled: boolean) {
    const s = this.must(sessionId)
    await s.q.setMaxThinkingTokens(enabled ? null : 0)
    s.meta.thinkingOff = !enabled
    this.emitMeta(s)
  }

  async setFastMode(sessionId: string, enabled: boolean) {
    const s = this.must(sessionId)
    await s.q.applyFlagSettings({ fastMode: enabled })
    s.meta.fastMode = enabled
    this.emitMeta(s)
  }

  async setMcpServers(sessionId: string, servers: Record<string, McpServerSpec>) {
    const s = this.must(sessionId)
    const r = await s.q.setMcpServers({ ...toMcpConfig(servers), aimux: s.ownTools })
    const failed = Object.entries(r.errors ?? {})
    if (failed.length) throw new Error(failed.map(([name, e]) => `${name}: ${e}`).join('; '))
  }

  async getUsage(sessionId: string): Promise<UsageInfo> {
    const q = this.must(sessionId).q
    const [account, usage] = await Promise.all([
      q.accountInfo().catch(() => null),
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET().catch(() => null),
    ])
    const rl = usage?.rate_limits
    const extra = rl?.extra_usage
    const windows: [string, { utilization: number | null; resets_at: string | null } | null | undefined][] = [
      ['5 sati', rl?.five_hour], ['7 dana', rl?.seven_day], ['7 dana · Opus', rl?.seven_day_opus], ['7 dana · Sonnet', rl?.seven_day_sonnet],
    ]
    return {
      email: account?.email,
      organization: account?.organization,
      subscription: account?.subscriptionType ?? usage?.subscription_type ?? undefined,
      limits: windows.flatMap(([label, w]) => (w && w.utilization !== null ? [{ label, percent: Math.round(w.utilization), resetsAt: w.resets_at }] : [])),
      extra: extra?.is_enabled ? { used: extra.used_credits, limit: extra.monthly_limit, currency: extra.currency } : undefined,
      linesAdded: usage?.session.total_lines_added ?? 0,
      linesRemoved: usage?.session.total_lines_removed ?? 0,
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
    return listSessions({ dir: cwd, limit: 80 })
  }

  async getHistory(sdkSessionId: string, cwd?: string): Promise<HistoryMessage[]> {
    const msgs = await getSessionMessages(sdkSessionId, { dir: cwd })
    return msgs.map((m) => ({ type: m.type, uuid: m.uuid, message: m.message, parent_tool_use_id: m.parent_tool_use_id }))
  }

  async getSessionInfo(sdkSessionId: string, cwd?: string): Promise<SDKSessionInfo | null> {
    return (await getSessionInfo(sdkSessionId, { dir: cwd })) ?? null
  }

  async setModel(sessionId: string, model?: string) {
    const s = this.must(sessionId)
    await s.q.setModel(model)
    s.meta.model = model ?? s.meta.model
    this.emitMeta(s)
  }

  async setEffort(sessionId: string, effort: EffortLevel | null) {
    const s = this.must(sessionId)
    await s.q.applyFlagSettings({ effortLevel: effort })
    s.meta.effort = effort ?? undefined
    this.emitMeta(s)
  }

  async getModels(sessionId: string): Promise<ModelOption[]> {
    // The CLI may already be gone (failed start, closed session); the UI then just has no list.
    const models = await this.must(sessionId).q.supportedModels().catch(() => [])
    return models.map((m) => ({
      value: m.value, resolved: m.resolvedModel, label: m.displayName, description: m.description,
      efforts: m.supportsEffort ? m.supportedEffortLevels : undefined,
    }))
  }

  async getCommands(sessionId: string): Promise<SlashCommandInfo[]> {
    const cmds = await this.must(sessionId).q.supportedCommands().catch(() => [])
    return cmds.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint }))
  }

  async getMcpStatus(sessionId: string): Promise<McpServerInfo[]> {
    const servers = await this.must(sessionId).q.mcpServerStatus()
    return servers.map((m) => ({
      name: m.name,
      status: m.status,
      error: m.error,
      scope: m.scope,
      version: m.serverInfo?.version,
      url: m.config && 'url' in m.config ? m.config.url : undefined,
      tools: (m.tools ?? []).map((t) => t.name),
    }))
  }

  reconnectMcp(sessionId: string, name: string) { return this.must(sessionId).q.reconnectMcpServer(name) }
  toggleMcp(sessionId: string, name: string, enabled: boolean) { return this.must(sessionId).q.toggleMcpServer(name, enabled) }

  /** Permission rules and hooks per settings file, as a session in `cwd` would load them. */
  async getSettingsInfo(cwd: string): Promise<SettingsSourceInfo[]> {
    const resolved = await resolveSettings({ cwd, settingSources: ['user', 'project', 'local'] })
    const paths = settingsPaths(cwd) as Record<string, string | undefined>
    const sources = resolved.sources.map((src) => {
      const perms = (src.settings.permissions ?? {}) as { allow?: string[]; deny?: string[]; ask?: string[]; defaultMode?: string }
      const hooks: HookInfo[] = []
      for (const [event, matchers] of Object.entries((src.settings.hooks ?? {}) as Record<string, Array<{ matcher?: string; hooks?: unknown[] }>>)) {
        for (const m of matchers ?? []) {
          for (const h of m.hooks ?? []) {
            const hk = h as { type?: string; command?: string; prompt?: string; url?: string }
            hooks.push({ event, matcher: m.matcher, command: hk.command ?? hk.prompt ?? hk.url ?? hk.type ?? '' })
          }
        }
      }
      return {
        source: src.source as string, path: src.path ?? paths[src.source],
        allow: perms.allow ?? [], deny: perms.deny ?? [], ask: perms.ask ?? [],
        defaultMode: perms.defaultMode, hooks,
      }
    })
    // Files that do not exist yet are listed too, so a first rule can be written to them.
    for (const [source, path] of Object.entries(paths)) {
      if (!sources.some((s) => s.source === source)) sources.push({ source, path, allow: [], deny: [], ask: [], defaultMode: undefined, hooks: [] })
    }
    return sources
  }

  async renameSession(sessionId: string, title: string) {
    const s = this.must(sessionId)
    const t = title.trim()
    if (!t) return
    s.meta.title = t
    s.customTitle = true
    this.emitMeta(s)
    if (s.meta.sdkSessionId) await renameSession(s.meta.sdkSessionId, t, { dir: s.meta.cwd })
  }

  renameStored(sdkSessionId: string, title: string, cwd?: string) { return renameSession(sdkSessionId, title, { dir: cwd }) }
  tagStored(sdkSessionId: string, tag: string | null, cwd?: string) { return tagSession(sdkSessionId, tag, { dir: cwd }) }
  deleteStored(sdkSessionId: string, cwd?: string) { return deleteSession(sdkSessionId, { dir: cwd }) }

  async fork(sessionId: string, opts: ForkOptions = {}): Promise<{ sdkSessionId: string | null }> {
    const s = this.must(sessionId)
    const sdkId = s.meta.sdkSessionId
    if (!sdkId) return { sdkSessionId: null }
    let upTo: string | undefined
    if (opts.beforeUuid || opts.beforeText !== undefined) {
      const msgs = await getSessionMessages(sdkId, { dir: s.meta.cwd })
      let i = opts.beforeUuid ? msgs.findIndex((m) => m.uuid === opts.beforeUuid) : -1
      if (i < 0 && opts.beforeText !== undefined) {
        const want = opts.beforeText.trim()
        for (let k = msgs.length - 1; k >= 0 && i < 0; k--) {
          const m = msgs[k]
          if (m.type === 'user' && promptText((m.message as { content?: unknown })?.content).trim() === want) i = k
        }
      }
      if (i < 0) throw new Error('Poruka nije pronađena u transkriptu')
      if (i === 0) return { sdkSessionId: null }
      upTo = msgs[i - 1].uuid
    }
    const r = await forkSession(sdkId, { dir: s.meta.cwd, upToMessageId: upTo, title: opts.title })
    return { sdkSessionId: r.sessionId }
  }

  async rewindFiles(sessionId: string, userMessageUuid: string, dryRun: boolean): Promise<RewindResult> {
    const r = await this.must(sessionId).q.rewindFiles(userMessageUuid, { dryRun })
    return { canRewind: r.canRewind, error: r.error, filesChanged: r.filesChanged, insertions: r.insertions, deletions: r.deletions }
  }

  /** Remote Control: the session becomes drivable from claude.ai / the mobile app. */
  async setRemoteControl(sessionId: string, enabled: boolean) {
    const s = this.must(sessionId)
    // Present at runtime but missing from the SDK's public typings.
    const q = s.q as Query & {
      enableRemoteControl?(enabled: boolean, name?: string): Promise<{ session_url?: string } | undefined>
    }
    if (!q.enableRemoteControl) throw new Error('Ova verzija SDK-a ne podržava Remote Control')
    const res = await q.enableRemoteControl(enabled, s.meta.title === DEFAULT_TITLE ? undefined : s.meta.title)
    if (enabled && !res?.session_url) throw new Error('Remote Control nije vratio poveznicu')
    s.meta.remoteUrl = enabled ? res?.session_url : undefined
    this.emitMeta(s)
    return s.meta.remoteUrl ?? null
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
