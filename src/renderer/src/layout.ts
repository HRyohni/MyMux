// Pane layout helpers and the saved-workspace format. Pure, so it is unit-testable.
import type { PermissionMode, EffortLevel } from '../../shared/ipc'

/** Binary split tree, like a terminal multiplexer. */
export type Layout =
  | { kind: 'leaf'; id: string; sessionId: string | null }
  | { kind: 'split'; id: string; dir: 'horizontal' | 'vertical'; a: Layout; b: Layout }

export type Leaf = Extract<Layout, { kind: 'leaf' }>

/** A group is an independent pane layout (like a tmux window / wmux workspace). */
export interface Group { id: string; name: string; layout: Layout; focusedPane: string; tucked?: TuckedPane[] }

/** A conversation pulled out of its split to the edge of the window, and where it goes back to. */
export interface TuckedPane {
  sessionId: string
  paneId: string
  splitId: string
  dir: 'horizontal' | 'vertical'
  side: 'a' | 'b'
  /** The node that stayed in the split. */
  sibling: string
}

export function leaves(l: Layout): Leaf[] {
  return l.kind === 'leaf' ? [l] : [...leaves(l.a), ...leaves(l.b)]
}
export function mapLayout(l: Layout, fn: (leaf: Leaf) => Layout): Layout {
  return l.kind === 'leaf' ? fn(l) : { ...l, a: mapLayout(l.a, fn), b: mapLayout(l.b, fn) }
}
export function removeLeaf(l: Layout, id: string): Layout | null {
  if (l.kind === 'leaf') return l.id === id ? null : l
  const a = removeLeaf(l.a, id)
  const b = removeLeaf(l.b, id)
  if (a && b) return { ...l, a, b }
  return a ?? b
}
/** Where a pane sits in its parent split; null for a pane that fills the whole layout. */
export function tuckOf(l: Layout, paneId: string): Omit<TuckedPane, 'sessionId' | 'paneId'> | null {
  if (l.kind === 'leaf') return null
  for (const side of ['a', 'b'] as const) {
    const other = side === 'a' ? l.b : l.a
    if (l[side].kind === 'leaf' && l[side].id === paneId) return { splitId: l.id, dir: l.dir, side, sibling: other.id }
  }
  return tuckOf(l.a, paneId) ?? tuckOf(l.b, paneId)
}

function hasNode(l: Layout, id: string): boolean {
  return l.id === id || (l.kind === 'split' && (hasNode(l.a, id) || hasNode(l.b, id)))
}

function wrapNode(l: Layout, id: string, fn: (node: Layout) => Layout): Layout {
  if (l.id === id) return fn(l)
  return l.kind === 'leaf' ? l : { ...l, a: wrapNode(l.a, id, fn), b: wrapNode(l.b, id, fn) }
}

/** Puts a tucked pane back next to its sibling, or next to `fallback` if the sibling is gone. */
export function untuck(l: Layout, t: TuckedPane, fallback: string): Layout {
  const pane: Layout = { kind: 'leaf', id: t.paneId, sessionId: t.sessionId }
  const target = hasNode(l, t.sibling) ? t.sibling : fallback
  const side = target === t.sibling ? t.side : 'b'
  return wrapNode(l, target, (node) => ({
    kind: 'split', id: t.splitId, dir: t.dir, a: side === 'a' ? pane : node, b: side === 'a' ? node : pane,
  }))
}

export function paneOfSession(l: Layout, sessionId: string): string | null {
  return leaves(l).find((x) => x.sessionId === sessionId)?.id ?? null
}
/** Which group shows a session, if any. */
export function groupOfSession(groups: Group[], sessionId: string): Group | null {
  return groups.find((g) => paneOfSession(g.layout, sessionId)) ?? null
}

// ---------------------------------------------------------------------------
// Saved workspace: what is needed to rebuild groups, splits and open conversations after a restart.

export interface SavedSession {
  /** The session's id at save time; panes refer to it. */
  key: string
  sdkSessionId?: string
  cwd: string
  title: string
  permissionMode: PermissionMode
  model?: string
  effort?: EffortLevel
  browserOpen: boolean
}

export interface SavedWorkspace {
  v: 1
  groups: Group[]
  activeGroup: string
  sessions: SavedSession[]
  /** Sidebar order, by session key. */
  order: string[]
}

interface WorkspaceSource {
  groups: Group[]
  activeGroup: string
  order: string[]
  sessions: Record<string, {
    meta: { id: string; sdkSessionId?: string; cwd: string; title: string; permissionMode: PermissionMode; model?: string; effort?: EffortLevel }
    browserOpen: boolean
  }>
}

export function serializeWorkspace(s: WorkspaceSource): SavedWorkspace {
  return {
    v: 1,
    groups: s.groups,
    activeGroup: s.activeGroup,
    order: s.order.filter((id) => s.sessions[id]),
    sessions: Object.values(s.sessions).map(({ meta, browserOpen }) => ({
      key: meta.id, sdkSessionId: meta.sdkSessionId, cwd: meta.cwd, title: meta.title,
      permissionMode: meta.permissionMode, model: meta.model, effort: meta.effort, browserOpen,
    })),
  }
}

function validLayout(l: unknown): l is Layout {
  if (!l || typeof l !== 'object') return false
  const x = l as Record<string, unknown>
  if (x.kind === 'leaf') return typeof x.id === 'string' && (x.sessionId === null || typeof x.sessionId === 'string')
  return x.kind === 'split' && typeof x.id === 'string' && (x.dir === 'horizontal' || x.dir === 'vertical')
    && validLayout(x.a) && validLayout(x.b)
}

export function parseWorkspace(json: string | null): SavedWorkspace | null {
  if (!json) return null
  try {
    const w = JSON.parse(json) as SavedWorkspace
    if (w?.v !== 1 || !Array.isArray(w.groups) || w.groups.length === 0 || !Array.isArray(w.sessions)) return null
    if (!w.groups.every((g) => g && typeof g.id === 'string' && typeof g.name === 'string' && validLayout(g.layout))) return null
    return { ...w, order: Array.isArray(w.order) ? w.order : [] }
  } catch { return null }
}

/**
 * Rebuilds groups from a saved workspace once its sessions have been reopened.
 * `idOf` maps a saved session key to the id of the reopened session; panes of sessions that could
 * not be reopened become empty.
 */
export function restoreGroups(w: SavedWorkspace, idOf: Map<string, string>): { groups: Group[]; activeGroup: string; order: string[] } {
  const groups = w.groups.map((g) => {
    const layout = mapLayout(g.layout, (l) => ({ ...l, sessionId: (l.sessionId && idOf.get(l.sessionId)) || null }))
    const ids = leaves(layout).map((l) => l.id)
    const tucked = (g.tucked ?? []).flatMap((t) => {
      const sessionId = idOf.get(t.sessionId)
      return sessionId ? [{ ...t, sessionId }] : []
    })
    return { ...g, layout, tucked, focusedPane: ids.includes(g.focusedPane) ? g.focusedPane : ids[0] }
  })
  return {
    groups,
    activeGroup: groups.some((g) => g.id === w.activeGroup) ? w.activeGroup : groups[0].id,
    order: w.order.map((k) => idOf.get(k)).filter((x): x is string => !!x),
  }
}
