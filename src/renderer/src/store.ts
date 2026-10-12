import { create } from 'zustand'
import type {
  SDKMessage, SessionMeta, PermissionRequest, PermissionMode, BrowserState, HistoryMessage, DownloadInfo, ModelOption,
  EffortLevel, ElicitationRequest,
} from '../../shared/ipc'
import { reduce, nid, withSubagent, type ChatItem } from './reducer'
import {
  leaves, mapLayout, removeLeaf, paneOfSession, groupOfSession, serializeWorkspace, type Group, type Layout,
} from './layout'

export type { ChatItem, Block, ToolResult, ToolBlock } from './reducer'
export type { Layout, Group } from './layout'
export { leaves, paneOfSession, groupOfSession }

export interface SessionState {
  meta: SessionMeta
  items: ChatItem[]
  pending: PermissionRequest[]
  /** MCP servers waiting for the user's input. */
  elicitations: ElicitationRequest[]
  browser: BrowserState | null
  browserOpen: boolean
  downloads: DownloadInfo[]
  /** Text to put into the composer (edit of an earlier message); the nonce makes repeats distinct. */
  draft?: { text: string; nonce: number }
  findOpen: boolean
  browserFindOpen: boolean
}

export interface RecentEntry { sdkSessionId: string; cwd: string; title: string; at: number }

interface Store {
  sessions: Record<string, SessionState>
  order: string[]
  groups: Group[]
  activeGroup: string
  sidebarCollapsed: boolean
  toggleSidebar(): void
  /** Open modal dialogs. The embedded browser views draw above the DOM, so they hide while this is > 0. */
  overlays: number
  pushOverlay(): void
  popOverlay(): void
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
  overviewOpen: boolean
  setOverviewOpen(open: boolean): void
  /** Models the CLI offers, learned from the first live session. */
  models: ModelOption[]
  setModels(models: ModelOption[]): void
  // groups
  addGroup(): void
  removeGroup(id: string): void
  switchGroup(id: string): void
  renameGroup(id: string, name: string): void
  /** Replaces the layout wholesale (workspace restore). */
  hydrate(groups: Group[], activeGroup: string, order: string[]): void
  // sessions
  addSession(meta: SessionMeta, paneId?: string | null, browserOpen?: boolean): void
  removeSession(id: string): void
  applyMeta(meta: SessionMeta): void
  applyMessage(sessionId: string, msg: SDKMessage): void
  loadHistory(sessionId: string, msgs: HistoryMessage[]): void
  addInfo(sessionId: string, text: string, level?: 'info' | 'error'): void
  addPermission(req: PermissionRequest): void
  resolvePermission(sessionId: string, requestId: string): void
  addElicitation(req: ElicitationRequest): void
  resolveElicitation(sessionId: string, requestId: string): void
  /** Attaches a stored subagent transcript to its Agent call. */
  loadSubagent(sessionId: string, toolId: string, msgs: HistoryMessage[]): void
  applyBrowserState(state: BrowserState): void
  setBrowserOpen(sessionId: string, open: boolean): void
  applyDownload(d: DownloadInfo): void
  clearDownloads(sessionId: string): void
  setDraft(sessionId: string, text: string): void
  setFindOpen(sessionId: string, open: boolean): void
  setBrowserFindOpen(sessionId: string, open: boolean): void
  // panes
  focusPane(paneId: string): void
  splitPane(paneId: string, dir: 'horizontal' | 'vertical'): string
  closePane(paneId: string): void
  setPaneSession(paneId: string, sessionId: string | null): void
  /** Shows a session in the given pane, taking it out of whichever pane had it (drag and drop). */
  moveSession(sessionId: string, paneId: string): void
  showSession(sessionId: string): void
}

export const selectActiveGroup = (s: { groups: Group[]; activeGroup: string }): Group =>
  s.groups.find((g) => g.id === s.activeGroup) ?? s.groups[0]
export const selectLayout = (s: { groups: Group[]; activeGroup: string }) => selectActiveGroup(s).layout
export const selectFocusedPane = (s: { groups: Group[]; activeGroup: string }) => selectActiveGroup(s).focusedPane

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
export function forgetRecent(sdkSessionId: string) {
  try { localStorage.setItem('aimux.recent', JSON.stringify(readRecent().filter((r) => r.sdkSessionId !== sdkSessionId))) } catch { /* ignore */ }
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

const freshSession = (meta: SessionMeta, browserOpen = false): SessionState => ({
  meta, items: [], pending: [], elicitations: [], browser: null, browserOpen, downloads: [], findOpen: false, browserFindOpen: false,
})

export const useStore = create<Store>((set, get) => ({
  sessions: {},
  order: [],
  groups: [{ id: rootGroup, name: 'Grupa 1', layout: { kind: 'leaf', id: rootPane, sessionId: null }, focusedPane: rootPane }],
  activeGroup: rootGroup,
  sidebarCollapsed: (() => { try { return localStorage.getItem('aimux.sidebarCollapsed') === '1' } catch { return false } })(),

  toggleSidebar: () => set((s) => {
    const next = !s.sidebarCollapsed
    try { localStorage.setItem('aimux.sidebarCollapsed', next ? '1' : '0') } catch { /* ignore */ }
    return { sidebarCollapsed: next }
  }),

  overlays: 0,
  pushOverlay: () => set((s) => ({ overlays: s.overlays + 1 })),
  popOverlay: () => set((s) => ({ overlays: Math.max(0, s.overlays - 1) })),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  overviewOpen: false,
  setOverviewOpen: (open) => set({ overviewOpen: open }),
  models: [],
  setModels: (models) => set({ models }),

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

  hydrate: (groups, activeGroup, order) => set((s) => ({
    groups, activeGroup, order: [...order, ...s.order.filter((id) => !order.includes(id))],
  })),

  addSession: (meta, paneId, browserOpen) => set((s) => {
    const base = {
      sessions: { ...s.sessions, [meta.id]: freshSession(meta, browserOpen) },
      order: [meta.id, ...s.order.filter((x) => x !== meta.id)],
    }
    // null: the session is only listed in the sidebar, not shown in a pane.
    if (paneId === null) return base
    const target = paneId ?? selectActiveGroup(s).focusedPane
    const owner = s.groups.find((g) => leaves(g.layout).some((l) => l.id === target))
    if (!owner) return base
    return {
      ...base,
      ...updateGroup(s, (gr) => ({
        layout: mapLayout(gr.layout, (l) => (l.id === target ? { ...l, sessionId: meta.id } : l)),
        focusedPane: target,
      }), owner.id),
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
        sessions: { ...s.sessions, [meta.id]: freshSession(meta) },
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
      items = reduce(items, { type: m.type, uuid: m.uuid, message: m.message, parent_tool_use_id: m.parent_tool_use_id } as unknown as SDKMessage)
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

  addElicitation: (req) => set((s) => updateSession(s, req.sessionId, (cur) => ({ elicitations: [...cur.elicitations, req] }))),

  resolveElicitation: (sessionId, requestId) => set((s) => updateSession(s, sessionId, (cur) => ({
    elicitations: cur.elicitations.filter((e) => e.requestId !== requestId),
  }))),

  loadSubagent: (sessionId, toolId, msgs) => set((s) => updateSession(s, sessionId, (cur) => {
    const items = withSubagent(cur.items, toolId, msgs)
    return items === cur.items ? {} : { items }
  })),

  applyBrowserState: (state) => set((s) => updateSession(s, state.sessionId, () => ({ browser: state }))),

  setBrowserOpen: (sessionId, open) => set((s) => updateSession(s, sessionId, (cur) => (cur.browserOpen === open ? {} : { browserOpen: open }))),

  applyDownload: (d) => set((s) => updateSession(s, d.sessionId, (cur) => ({
    downloads: cur.downloads.some((x) => x.id === d.id) ? cur.downloads.map((x) => (x.id === d.id ? d : x)) : [...cur.downloads, d],
  }))),

  clearDownloads: (sessionId) => set((s) => updateSession(s, sessionId, (cur) => ({
    downloads: cur.downloads.filter((d) => d.state === 'progressing'),
  }))),

  setDraft: (sessionId, text) => set((s) => updateSession(s, sessionId, () => ({ draft: { text, nonce: Date.now() } }))),

  setFindOpen: (sessionId, open) => set((s) => updateSession(s, sessionId, () => ({ findOpen: open }))),

  setBrowserFindOpen: (sessionId, open) => set((s) => updateSession(s, sessionId, () => ({ browserFindOpen: open }))),

  focusPane: (paneId) => set((s) => (selectFocusedPane(s) === paneId ? {} : updateGroup(s, () => ({ focusedPane: paneId })))),

  splitPane: (paneId, dir) => {
    const fresh = { kind: 'leaf' as const, id: nid(), sessionId: null }
    set((s) => updateGroup(s, (g) => ({
      layout: mapLayout(g.layout, (l) => (l.id === paneId ? { kind: 'split', id: nid(), dir, a: l, b: fresh } : l)),
      focusedPane: fresh.id,
    })))
    return fresh.id
  },

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

  moveSession: (sessionId, paneId) => set((s) => {
    if (!s.sessions[sessionId]) return {}
    const owner = s.groups.find((g) => leaves(g.layout).some((l) => l.id === paneId))
    if (!owner) return {}
    return {
      activeGroup: owner.id,
      groups: s.groups.map((g) => ({
        ...g,
        layout: mapLayout(g.layout, (l) => (l.id === paneId ? { ...l, sessionId } : l.sessionId === sessionId ? { ...l, sessionId: null } : l)),
        focusedPane: g.id === owner.id ? paneId : g.focusedPane,
      })),
    }
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

// ---------------------------------------------------------------------------
// Workspace persistence: groups, splits and open conversations survive a restart.

export const WORKSPACE_KEY = 'aimux.workspace'

/** Starts saving the workspace on every change. Called once the saved one has been restored. */
export function startWorkspacePersistence() {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  useStore.subscribe((s) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const json = JSON.stringify(serializeWorkspace(s))
      if (json === last) return
      last = json
      try { localStorage.setItem(WORKSPACE_KEY, json) } catch { /* storage unavailable */ }
    }, 300)
  })
}

export const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Pitaj', hint: 'Traži odobrenje za alate koji mijenjaju stanje' },
  { value: 'acceptEdits', label: 'Prihvati izmjene', hint: 'Izmjene datoteka bez pitanja, ostalo pita' },
  { value: 'bypassPermissions', label: 'Bez pitanja', hint: 'Sve dopušteno, koristi oprezno' },
  { value: 'plan', label: 'Plan', hint: 'Samo čitanje i planiranje' },
]

/** Shown until a live session reports what the CLI really offers. */
export const FALLBACK_MODELS: ModelOption[] = [
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'nizak', medium: 'srednji', high: 'visok', xhigh: 'vrlo visok', max: 'maksimalan',
}
