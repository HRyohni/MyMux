// Operations that span the store and the main process: opening, restoring, forking and closing sessions.
import { useStore, forgetRecent, WORKSPACE_KEY, startWorkspacePersistence } from './store'
import { parseWorkspace, restoreGroups, serializeWorkspace, type SavedWorkspace } from './layout'
import { unloadedAgents } from './reducer'
import { useSettings } from './settings'
import type { CreateSessionOptions, SessionMeta } from '../../shared/ipc'

export const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Creates a session and shows it in the given pane (null: sidebar only), loading the transcript
 * and its title when resuming.
 */
export async function openSession(paneId: string | null, opts: CreateSessionOptions, browserOpen = false): Promise<SessionMeta> {
  let title = opts.title
  let missing = false
  if (opts.resume) {
    const info = await window.aimux.getSessionInfo(opts.resume, opts.cwd).catch(() => null)
      ?? await window.aimux.getSessionInfo(opts.resume).catch(() => null)
    // Resuming a transcript that is gone (deleted, or never written because nothing was sent) kills the CLI.
    if (!info) {
      missing = true
      opts = { ...opts, resume: undefined }
    } else if (!title) {
      title = (info.customTitle || info.summary || '').replace(/\s+/g, ' ').slice(0, 60) || undefined
    }
  }
  const meta = await window.aimux.createSession({ mcpServers: useSettings.getState().mcpServers, ...opts, title })
  useStore.getState().addSession(meta, paneId, browserOpen)
  if (missing) useStore.getState().addInfo(meta.id, 'Prijašnji razgovor nije pronađen, pa je započet novi.', 'info')
  if (opts.resume) {
    try {
      const history = await window.aimux.getHistory(opts.resume, opts.cwd)
      useStore.getState().loadHistory(meta.id, history)
      void loadSubagents(meta.id, opts.resume, opts.cwd)
    } catch (e) {
      useStore.getState().addInfo(meta.id, `Povijest nije učitana: ${errText(e)}`, 'error')
    }
  }
  return meta
}

/** Fills in the nested transcripts of the subagents a resumed conversation had started. */
async function loadSubagents(sessionId: string, sdkSessionId: string, cwd: string) {
  const calls = unloadedAgents(useStore.getState().sessions[sessionId]?.items ?? [])
  if (calls.length === 0) return
  const history = await window.aimux.getSubagentHistory(sdkSessionId, cwd, calls.map((c) => c.agentId)).catch(() => ({}))
  for (const c of calls) {
    const msgs = (history as Record<string, Parameters<ReturnType<typeof useStore.getState>['loadSubagent']>[2]>)[c.agentId]
    if (msgs?.length) useStore.getState().loadSubagent(sessionId, c.toolId, msgs)
  }
}

/** Opens the conversations of a saved workspace and lays them out as they were. */
async function applyWorkspace(saved: SavedWorkspace) {
  const idOf = new Map<string, string>()
  await Promise.all(saved.sessions.map(async (s) => {
    try {
      const meta = await openSession(null, {
        cwd: s.cwd, resume: s.sdkSessionId, permissionMode: s.permissionMode, model: s.model, effort: s.effort,
        title: s.sdkSessionId ? s.title : undefined,
      }, s.browserOpen)
      idOf.set(s.key, meta.id)
    } catch (e) {
      console.warn('[aimux] sesija nije vraćena', s.title, e)
    }
  }))
  const r = restoreGroups(saved, idOf)
  useStore.getState().hydrate(r.groups, r.activeGroup, r.order)
}

const LAYOUTS_KEY = 'aimux.layouts'

/** Named workspaces the user saved (groups, splits and their conversations). */
export function readLayouts(): Record<string, SavedWorkspace> {
  try {
    const all = JSON.parse(localStorage.getItem(LAYOUTS_KEY) ?? '{}') as Record<string, unknown>
    const out: Record<string, SavedWorkspace> = {}
    for (const [name, w] of Object.entries(all)) {
      const parsed = parseWorkspace(JSON.stringify(w))
      if (parsed) out[name] = parsed
    }
    return out
  } catch { return {} }
}

function writeLayouts(all: Record<string, SavedWorkspace>) {
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(all)) } catch { /* storage unavailable */ }
}

export function saveLayout(name: string) {
  writeLayouts({ ...readLayouts(), [name]: serializeWorkspace(useStore.getState()) })
}

export function deleteLayout(name: string) {
  const { [name]: _gone, ...rest } = readLayouts()
  writeLayouts(rest)
}

/** Replaces what is open with a saved layout. The conversations being closed stay resumable. */
export async function loadLayout(name: string) {
  const saved = readLayouts()[name]
  if (!saved) return
  await Promise.all(Object.keys(useStore.getState().sessions).map((id) => closeSession(id)))
  await applyWorkspace(saved)
}

let restored: Promise<void> | null = null

/** Reopens the groups, splits and conversations that were open when the app last closed. Runs once. */
export function restoreWorkspace(): Promise<void> {
  restored ??= (async () => {
    try {
      const saved = parseWorkspace(localStorage.getItem(WORKSPACE_KEY))
      // Sessions created before the UI was up (dev hooks) own the initial pane; leave the layout alone then.
      if (saved && Object.keys(useStore.getState().sessions).length === 0) await applyWorkspace(saved)
    } finally {
      startWorkspacePersistence()
    }
  })()
  return restored
}

/** Ends a session's process and removes it from the UI. The transcript stays on disk. */
export async function closeSession(sessionId: string) {
  await window.aimux.closeSession(sessionId).catch(() => {})
  useStore.getState().removeSession(sessionId)
}

/**
 * Continues the conversation from just before one of its prompts, in a copy of the transcript.
 * The original stays untouched and resumable. `inPlace` swaps the copy into the same pane,
 * otherwise it opens in a new split. Returns the new session.
 */
export async function branchBefore(
  sessionId: string, paneId: string, prompt: { uuid?: string; text: string }, inPlace: boolean,
): Promise<SessionMeta> {
  const st = useStore.getState()
  const meta = st.sessions[sessionId]?.meta
  if (!meta) throw new Error('Sesija više nije otvorena')
  const { sdkSessionId } = await window.aimux.fork(sessionId, { beforeUuid: prompt.uuid, beforeText: prompt.text, title: meta.title })
  const opts: CreateSessionOptions = {
    cwd: meta.cwd, resume: sdkSessionId ?? undefined, permissionMode: meta.permissionMode, model: meta.model, effort: meta.effort,
    title: sdkSessionId ? meta.title : undefined,
  }
  if (inPlace) {
    await closeSession(sessionId)
    return openSession(paneId, opts)
  }
  return openSession(st.splitPane(paneId, 'horizontal'), opts)
}

/** Copies the whole conversation into a new session shown in a split next to the original. */
export async function forkToSplit(sessionId: string, paneId: string): Promise<void> {
  const st = useStore.getState()
  const meta = st.sessions[sessionId]?.meta
  if (!meta) return
  const { sdkSessionId } = await window.aimux.fork(sessionId, { title: `${meta.title} (kopija)` })
  if (!sdkSessionId) throw new Error('Razgovor još nema poruka koje bi se kopirale')
  await openSession(st.splitPane(paneId, 'horizontal'), {
    cwd: meta.cwd, resume: sdkSessionId, permissionMode: meta.permissionMode, model: meta.model, effort: meta.effort,
  })
}

/** Deletes a stored transcript for good, closing the session first if it is open. */
export async function deleteStoredSession(sdkSessionId: string, cwd?: string) {
  const open = Object.values(useStore.getState().sessions).find((s) => s.meta.sdkSessionId === sdkSessionId)
  if (open) await closeSession(open.meta.id)
  await window.aimux.deleteStored(sdkSessionId, cwd)
  forgetRecent(sdkSessionId)
}

/** Hides a stored transcript from the session list (tag "archived"), closing it first if it is open. */
export async function archiveStoredSession(sdkSessionId: string, cwd: string | undefined, archived: boolean) {
  if (archived) {
    const open = Object.values(useStore.getState().sessions).find((s) => s.meta.sdkSessionId === sdkSessionId)
    if (open) await closeSession(open.meta.id)
    forgetRecent(sdkSessionId)
  }
  await window.aimux.tagStored(sdkSessionId, archived ? 'archived' : null, cwd)
}
