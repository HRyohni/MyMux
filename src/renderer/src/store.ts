import { create } from 'zustand'
import type {
  SDKMessage, SessionMeta, PermissionRequest, PermissionMode, BrowserState, HistoryMessage,
} from '../../shared/ipc'

export type ToolResult = { text: string; isError: boolean }

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; inputJson: string; result?: ToolResult; subLog?: string[] }

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; blocks: Block[]; streaming: boolean }
  | { kind: 'result'; id: string; costUsd: number; durationMs: number; turns: number; isError: boolean; text?: string }
  | { kind: 'info'; id: string; text: string; level: 'info' | 'error' }

export interface SessionState {
  meta: SessionMeta
  items: ChatItem[]
  pending: PermissionRequest[]
  browser: BrowserState | null
  browserOpen: boolean
}

/** Binary split tree, like a terminal multiplexer. */
export type Layout =
  | { kind: 'leaf'; id: string; sessionId: string | null }
  | { kind: 'split'; id: string; dir: 'horizontal' | 'vertical'; a: Layout; b: Layout }

export interface RecentEntry { sdkSessionId: string; cwd: string; title: string; at: number }

/** A group is an independent pane layout (like a tmux window / wmux workspace). */
export interface Group { id: string; name: string; layout: Layout; focusedPane: string }

interface Store {
  sessions: Record<string, SessionState>
  order: string[]
  groups: Group[]
  activeGroup: string
  // groups
  addGroup(): void
  removeGroup(id: string): void
  switchGroup(id: string): void
  renameGroup(id: string, name: string): void
  // sessions
  addSession(meta: SessionMeta, paneId?: string): void
  removeSession(id: string): void
  applyMeta(meta: SessionMeta): void
  applyMessage(sessionId: string, msg: SDKMessage): void
  loadHistory(sessionId: string, msgs: HistoryMessage[]): void
  addInfo(sessionId: string, text: string, level?: 'info' | 'error'): void
  addPermission(req: PermissionRequest): void
  resolvePermission(sessionId: string, requestId: string): void
  applyBrowserState(state: BrowserState): void
  setBrowserOpen(sessionId: string, open: boolean): void
  // panes
  focusPane(paneId: string): void
  splitPane(paneId: string, dir: 'horizontal' | 'vertical'): void
  closePane(paneId: string): void
  setPaneSession(paneId: string, sessionId: string | null): void
  showSession(sessionId: string): void
}

let counter = 0
const nid = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`

// ---------------------------------------------------------------------------
// Layout helpers

export function leaves(l: Layout): Extract<Layout, { kind: 'leaf' }>[] {
  return l.kind === 'leaf' ? [l] : [...leaves(l.a), ...leaves(l.b)]
}
function mapLayout(l: Layout, fn: (leaf: Extract<Layout, { kind: 'leaf' }>) => Layout): Layout {
  return l.kind === 'leaf' ? fn(l) : { ...l, a: mapLayout(l.a, fn), b: mapLayout(l.b, fn) }
}
function removeLeaf(l: Layout, id: string): Layout | null {
  if (l.kind === 'leaf') return l.id === id ? null : l
  const a = removeLeaf(l.a, id)
  const b = removeLeaf(l.b, id)
  if (a && b) return { ...l, a, b }
  return a ?? b
}
export function paneOfSession(l: Layout, sessionId: string): string | null {
  return leaves(l).find((x) => x.sessionId === sessionId)?.id ?? null
}

export const selectActiveGroup = (s: { groups: Group[]; activeGroup: string }): Group =>
  s.groups.find((g) => g.id === s.activeGroup) ?? s.groups[0]
export const selectLayout = (s: { groups: Group[]; activeGroup: string }) => selectActiveGroup(s).layout
export const selectFocusedPane = (s: { groups: Group[]; activeGroup: string }) => selectActiveGroup(s).focusedPane
/** Which group shows a session, if any. */
export function groupOfSession(groups: Group[], sessionId: string): Group | null {
  return groups.find((g) => paneOfSession(g.layout, sessionId)) ?? null
}

// ---------------------------------------------------------------------------
// Recent sessions (persisted for "restore" on the welcome screen)

export function readRecent(): RecentEntry[] {
  try { return JSON.parse(localStorage.getItem('aimux.recent') ?? '[]') } catch { return [] }
}
function rememberRecent(meta: SessionMeta) {
  if (!meta.sdkSessionId || meta.title === 'Novi razgovor') return
  try {
    const list = readRecent().filter((r) => r.sdkSessionId !== meta.sdkSessionId)
    list.unshift({ sdkSessionId: meta.sdkSessionId, cwd: meta.cwd, title: meta.title, at: Date.now() })
    localStorage.setItem('aimux.recent', JSON.stringify(list.slice(0, 20)))
  } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------------------
// Message reduction

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (c && typeof c === 'object' && 'type' in c) {
          const b = c as { type: string; text?: string }
          if (b.type === 'text') return b.text ?? ''
          if (b.type === 'image') return '[slika]'
        }
        return ''
      })
      .join('\n')
  }
  if (content == null) return ''
  try { return JSON.stringify(content, null, 2) } catch { return String(content) }
}

function apiBlocksToBlocks(content: unknown[], prev: Block[]): Block[] {
  const prevTools = new Map(prev.flatMap((b) => (b.type === 'tool_use' ? [[b.id, b] as const] : [])))
  const out: Block[] = []
  for (const raw of content) {
    const b = raw as { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }
    if (b.type === 'text') out.push({ type: 'text', text: b.text ?? '' })
    else if (b.type === 'thinking') out.push({ type: 'thinking', text: b.thinking ?? '' })
    else if (b.type === 'tool_use' && b.id) {
      const old = prevTools.get(b.id)
      out.push({
        type: 'tool_use', id: b.id, name: b.name ?? 'tool', input: b.input,
        inputJson: JSON.stringify(b.input ?? {}), result: old?.result, subLog: old?.subLog,
      })
    }
  }
  return out
}

function shortToolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  const first = ['description', 'command', 'file_path', 'pattern', 'url', 'query', 'path', 'ref']
    .map((k) => (typeof i[k] === 'string' ? (i[k] as string) : undefined))
    .find(Boolean)
  return first ? `${name}: ${first.slice(0, 120)}` : name
}

/** Appends subagent activity to the parent Agent/Task tool block. */
function appendSubLog(items: ChatItem[], parentId: string, lines: string[]): ChatItem[] {
  if (lines.length === 0) return items
  let touched = false
  const out = items.map((it) => {
    if (it.kind !== 'assistant') return it
    const blocks = it.blocks.map((b) => {
      if (b.type !== 'tool_use' || b.id !== parentId) return b
      touched = true
      return { ...b, subLog: [...(b.subLog ?? []), ...lines].slice(-80) }
    })
    return touched ? { ...it, blocks } : it
  })
  return touched ? out : items
}

function reduce(items: ChatItem[], msg: SDKMessage): ChatItem[] {
  const last = items[items.length - 1]
  const lastAssistant = last && last.kind === 'assistant' && last.streaming ? last : null

  switch (msg.type) {
    case 'stream_event': {
      if (msg.parent_tool_use_id) return items
      const ev = msg.event as { type: string; index?: number; content_block?: unknown; delta?: unknown }
      if (ev.type === 'message_start') {
        return [...items, { kind: 'assistant', id: nid(), blocks: [], streaming: true }]
      }
      if (!lastAssistant) return items
      const blocks = [...lastAssistant.blocks]
      if (ev.type === 'content_block_start' && ev.content_block) {
        const cb = ev.content_block as { type: string; id?: string; name?: string; text?: string; thinking?: string }
        if (cb.type === 'text') blocks.push({ type: 'text', text: cb.text ?? '' })
        else if (cb.type === 'thinking') blocks.push({ type: 'thinking', text: cb.thinking ?? '' })
        else if (cb.type === 'tool_use') blocks.push({ type: 'tool_use', id: cb.id ?? nid(), name: cb.name ?? 'tool', input: {}, inputJson: '' })
        else return items
      } else if (ev.type === 'content_block_delta' && ev.delta && typeof ev.index === 'number') {
        const d = ev.delta as { type: string; text?: string; thinking?: string; partial_json?: string }
        const b = blocks[ev.index]
        if (!b) return items
        if (d.type === 'text_delta' && b.type === 'text') blocks[ev.index] = { ...b, text: b.text + (d.text ?? '') }
        else if (d.type === 'thinking_delta' && b.type === 'thinking') blocks[ev.index] = { ...b, text: b.text + (d.thinking ?? '') }
        else if (d.type === 'input_json_delta' && b.type === 'tool_use') blocks[ev.index] = { ...b, inputJson: b.inputJson + (d.partial_json ?? '') }
        else return items
      } else if (ev.type === 'content_block_stop' && typeof ev.index === 'number') {
        const b = blocks[ev.index]
        if (b?.type === 'tool_use') {
          let input: unknown = {}
          try { input = b.inputJson ? JSON.parse(b.inputJson) : {} } catch { input = { _raw: b.inputJson } }
          blocks[ev.index] = { ...b, input }
        }
      } else if (ev.type === 'message_stop') {
        return [...items.slice(0, -1), { ...lastAssistant, blocks, streaming: false }]
      } else {
        return items
      }
      return [...items.slice(0, -1), { ...lastAssistant, blocks }]
    }

    case 'assistant': {
      const content = (msg.message as { content: unknown[] }).content ?? []
      if (msg.parent_tool_use_id) {
        const lines: string[] = []
        for (const raw of content) {
          const b = raw as { type: string; text?: string; name?: string; input?: unknown }
          if (b.type === 'text' && b.text?.trim()) lines.push(b.text.trim().replace(/\s+/g, ' ').slice(0, 200))
          else if (b.type === 'tool_use') lines.push('→ ' + shortToolSummary(b.name ?? 'tool', b.input))
        }
        return appendSubLog(items, msg.parent_tool_use_id, lines)
      }
      if (lastAssistant) {
        // While streaming, the SDK emits one `assistant` message per finished block.
        // Stream events already built the blocks; only take authoritative tool inputs from here.
        const incoming = apiBlocksToBlocks(content, [])
        let touched = false
        const blocks = lastAssistant.blocks.map((b) => {
          if (b.type !== 'tool_use') return b
          const m = incoming.find((x) => x.type === 'tool_use' && x.id === b.id)
          if (!m || m.type !== 'tool_use') return b
          touched = true
          return { ...b, input: m.input, inputJson: m.inputJson }
        })
        return touched ? [...items.slice(0, -1), { ...lastAssistant, blocks }] : items
      }
      // No streaming item (history replay): append as a complete message.
      return [...items, { kind: 'assistant', id: nid(), blocks: apiBlocksToBlocks(content, []), streaming: false }]
    }

    case 'user': {
      if (msg.parent_tool_use_id) return items
      const content = (msg.message as { content: unknown }).content
      if (typeof content === 'string') {
        return content.trim() ? [...items, { kind: 'user', id: nid(), text: content }] : items
      }
      if (!Array.isArray(content)) return items
      const results = content.filter((c) => c && typeof c === 'object' && (c as { type: string }).type === 'tool_result') as Array<{
        tool_use_id: string; content: unknown; is_error?: boolean
      }>
      if (results.length === 0) {
        const text = contentToText(content)
        return text.trim() ? [...items, { kind: 'user', id: nid(), text }] : items
      }
      return items.map((it) => {
        if (it.kind !== 'assistant') return it
        let touched = false
        const blocks = it.blocks.map((b) => {
          if (b.type !== 'tool_use') return b
          const r = results.find((x) => x.tool_use_id === b.id)
          if (!r) return b
          touched = true
          return { ...b, result: { text: contentToText(r.content), isError: !!r.is_error } }
        })
        return touched ? { ...it, blocks } : it
      })
    }

    case 'result': {
      const item: ChatItem = {
        kind: 'result', id: nid(), costUsd: msg.total_cost_usd, durationMs: msg.duration_ms,
        turns: msg.num_turns, isError: msg.is_error,
        text: msg.is_error ? ('result' in msg ? String(msg.result) : msg.subtype) : undefined,
      }
      const closed = lastAssistant ? [...items.slice(0, -1), { ...lastAssistant, streaming: false }] : items
      return [...closed, item]
    }

    default:
      return items
  }
}

// ---------------------------------------------------------------------------

const rootPane = `p${Date.now().toString(36)}`
const rootGroup = `g${Date.now().toString(36)}`

/** Applies a change to the active group (or the given one). */
function updateGroup(s: Store, fn: (g: Group) => Partial<Group>, id = s.activeGroup): Partial<Store> {
  return { groups: s.groups.map((g) => (g.id === id ? { ...g, ...fn(g) } : g)) }
}

function updateSession(s: Store, id: string, fn: (cur: SessionState) => Partial<SessionState>): Partial<Store> {
  const cur = s.sessions[id]
  if (!cur) return {}
  return { sessions: { ...s.sessions, [id]: { ...cur, ...fn(cur) } } }
}

export const useStore = create<Store>((set, get) => ({
  sessions: {},
  order: [],
  groups: [{ id: rootGroup, name: 'Grupa 1', layout: { kind: 'leaf', id: rootPane, sessionId: null }, focusedPane: rootPane }],
  activeGroup: rootGroup,

  addGroup: () => set((s) => {
    const pane = nid()
    const n = s.groups.length + 1
    const g: Group = { id: nid(), name: `Grupa ${n}`, layout: { kind: 'leaf', id: pane, sessionId: null }, focusedPane: pane }
    return { groups: [...s.groups, g], activeGroup: g.id }
  }),

  removeGroup: (id) => set((s) => {
    if (s.groups.length <= 1) {
      // Last group: just empty it.
      return updateGroup(s, (g) => ({ layout: mapLayout(g.layout, (l) => ({ ...l, sessionId: null })) }), id)
    }
    const idx = s.groups.findIndex((g) => g.id === id)
    const groups = s.groups.filter((g) => g.id !== id)
    const activeGroup = s.activeGroup === id ? groups[Math.max(0, idx - 1)].id : s.activeGroup
    return { groups, activeGroup }
  }),

  switchGroup: (id) => set((s) => (s.groups.some((g) => g.id === id) && s.activeGroup !== id ? { activeGroup: id } : {})),

  renameGroup: (id, name) => set((s) => updateGroup(s, () => ({ name: name.trim() || 'Grupa' }), id)),

  addSession: (meta, paneId) => set((s) => {
    const g = selectActiveGroup(s)
    const target = paneId ?? g.focusedPane
    return {
      sessions: { ...s.sessions, [meta.id]: { meta, items: [], pending: [], browser: null, browserOpen: false } },
      order: [meta.id, ...s.order.filter((x) => x !== meta.id)],
      ...updateGroup(s, (gr) => ({
        layout: mapLayout(gr.layout, (l) => (l.id === target ? { ...l, sessionId: meta.id } : l)),
        focusedPane: target,
      })),
    }
  }),

  removeSession: (id) => set((s) => {
    const { [id]: _gone, ...rest } = s.sessions
    return {
      sessions: rest,
      order: s.order.filter((x) => x !== id),
      groups: s.groups.map((g) => ({ ...g, layout: mapLayout(g.layout, (l) => (l.sessionId === id ? { ...l, sessionId: null } : l)) })),
    }
  }),

  applyMeta: (meta) => set((s) => {
    rememberRecent(meta)
    const cur = s.sessions[meta.id]
    if (!cur) {
      // Session created outside the UI (dev autoprompt): adopt it into the focused pane if empty.
      const g = selectActiveGroup(s)
      const focused = leaves(g.layout).find((l) => l.id === g.focusedPane)
      const place = focused && !focused.sessionId
      return {
        sessions: { ...s.sessions, [meta.id]: { meta, items: [], pending: [], browser: null, browserOpen: false } },
        order: [meta.id, ...s.order],
        ...(place ? updateGroup(s, (gr) => ({ layout: mapLayout(gr.layout, (l) => (l.id === gr.focusedPane ? { ...l, sessionId: meta.id } : l)) })) : {}),
      }
    }
    return { sessions: { ...s.sessions, [meta.id]: { ...cur, meta } } }
  }),

  applyMessage: (sessionId, msg) => set((s) => updateSession(s, sessionId, (cur) => {
    const items = reduce(cur.items, msg)
    return items === cur.items ? {} : { items }
  })),

  loadHistory: (sessionId, msgs) => set((s) => updateSession(s, sessionId, (cur) => {
    let items: ChatItem[] = []
    for (const m of msgs) {
      if (m.type === 'system') continue
      items = reduce(items, { type: m.type, message: m.message, parent_tool_use_id: m.parent_tool_use_id } as unknown as SDKMessage)
    }
    return { items: [...items, ...cur.items] }
  })),

  addInfo: (sessionId, text, level = 'info') => set((s) => updateSession(s, sessionId, (cur) => ({
    items: [...cur.items, { kind: 'info', id: nid(), text, level }],
  }))),

  addPermission: (req) => set((s) => updateSession(s, req.sessionId, (cur) => ({ pending: [...cur.pending, req] }))),

  resolvePermission: (sessionId, requestId) => set((s) => updateSession(s, sessionId, (cur) => ({
    pending: cur.pending.filter((p) => p.requestId !== requestId),
  }))),

  applyBrowserState: (state) => set((s) => updateSession(s, state.sessionId, () => ({ browser: state }))),

  setBrowserOpen: (sessionId, open) => set((s) => updateSession(s, sessionId, (cur) => (cur.browserOpen === open ? {} : { browserOpen: open }))),

  focusPane: (paneId) => set((s) => (selectFocusedPane(s) === paneId ? {} : updateGroup(s, () => ({ focusedPane: paneId })))),

  splitPane: (paneId, dir) => set((s) => {
    const fresh = { kind: 'leaf' as const, id: nid(), sessionId: null }
    return updateGroup(s, (g) => ({
      layout: mapLayout(g.layout, (l) => (l.id === paneId ? { kind: 'split', id: nid(), dir, a: l, b: fresh } : l)),
      focusedPane: fresh.id,
    }))
  }),

  closePane: (paneId) => set((s) => updateGroup(s, (g) => {
    const next = removeLeaf(g.layout, paneId)
    if (!next) return { layout: mapLayout(g.layout, (l) => ({ ...l, sessionId: null })) } // last pane: just empty it
    const focused = leaves(next).some((l) => l.id === g.focusedPane) ? g.focusedPane : leaves(next)[0].id
    return { layout: next, focusedPane: focused }
  })),

  setPaneSession: (paneId, sessionId) => set((s) => {
    if (sessionId) {
      const other = groupOfSession(s.groups, sessionId)
      if (other) {
        const pane = paneOfSession(other.layout, sessionId)!
        if (other.id !== s.activeGroup || pane !== paneId) {
          return { activeGroup: other.id, ...updateGroup(s, () => ({ focusedPane: pane }), other.id) }
        }
      }
    }
    return updateGroup(s, (g) => ({
      layout: mapLayout(g.layout, (l) => (l.id === paneId ? { ...l, sessionId } : l)),
      focusedPane: paneId,
    }))
  }),

  showSession: (sessionId) => {
    const s = get()
    const other = groupOfSession(s.groups, sessionId)
    if (other) {
      const pane = paneOfSession(other.layout, sessionId)!
      set({ activeGroup: other.id, ...updateGroup(s, () => ({ focusedPane: pane }), other.id) })
    } else {
      s.setPaneSession(selectFocusedPane(s), sessionId)
    }
  },
}))

export const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Pitaj', hint: 'Traži odobrenje za alate koji mijenjaju stanje' },
  { value: 'acceptEdits', label: 'Prihvati izmjene', hint: 'Izmjene datoteka bez pitanja, ostalo pita' },
  { value: 'bypassPermissions', label: 'Bez pitanja', hint: 'Sve dopušteno, koristi oprezno' },
  { value: 'plan', label: 'Plan', hint: 'Samo čitanje i planiranje' },
]

export const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Zadani model' },
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]
