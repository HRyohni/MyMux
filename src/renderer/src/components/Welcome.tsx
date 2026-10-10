import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, History, ArrowRight, Search, RotateCcw } from 'lucide-react'
import { useStore, PERMISSION_MODES, readRecent, type RecentEntry } from '../store'
import type { SDKSessionInfo, PermissionMode } from '../../../shared/ipc'

/** Creates a session in the given pane, loading transcript history when resuming. */
export async function openSession(paneId: string, opts: { cwd: string; resume?: string; permissionMode?: PermissionMode }) {
  const st = useStore.getState()
  const meta = await window.aimux.createSession(opts)
  st.addSession(meta, paneId)
  if (opts.resume) {
    try {
      const history = await window.aimux.getHistory(opts.resume, opts.cwd)
      useStore.getState().loadHistory(meta.id, history)
      const firstUser = history.find((m) => m.type === 'user' && typeof (m.message as { content?: unknown })?.content === 'string')
      const text = firstUser ? String((firstUser.message as { content: string }).content) : ''
      if (text) useStore.getState().applyMeta({ ...meta, title: text.replace(/\s+/g, ' ').slice(0, 60) })
    } catch (e) {
      useStore.getState().addInfo(meta.id, `Povijest nije učitana: ${String(e)}`, 'error')
    }
  }
  return meta
}

export default function Welcome({ paneId }: { paneId: string }) {
  const [cwd, setCwd] = useState('')
  const [mode, setMode] = useState<PermissionMode>('default')
  const [recent, setRecent] = useState<SDKSessionInfo[]>([])
  const [allDirs, setAllDirs] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastOpen, setLastOpen] = useState<RecentEntry[]>([])
  const openSessions = useStore((s) => s.sessions)

  useEffect(() => {
    const saved = localStorage.getItem('aimux.cwd')
    if (saved) setCwd(saved)
    else window.aimux.homeDir().then(setCwd).catch(() => {})
    const open = new Set(Object.values(useStore.getState().sessions).map((s) => s.meta.sdkSessionId))
    setLastOpen(readRecent().filter((r) => !open.has(r.sdkSessionId)).slice(0, 6))
  }, [])

  useEffect(() => {
    if (!cwd && !allDirs) return
    let cancelled = false
    window.aimux.listSessions(allDirs ? undefined : cwd)
      .then((r) => { if (!cancelled) setRecent(r) })
      .catch(() => setRecent([]))
    return () => { cancelled = true }
  }, [cwd, allDirs])

  const openIds = useMemo(() => new Set(Object.values(openSessions).map((s) => s.meta.sdkSessionId)), [openSessions])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return recent
      .filter((r) => !openIds.has(r.sessionId))
      .filter((r) => !needle || [r.customTitle, r.summary, r.firstPrompt, r.cwd].some((x) => x?.toLowerCase().includes(needle)))
  }, [recent, q, openIds])

  const pick = async () => {
    const dir = await window.aimux.pickFolder()
    if (dir) setCwd(dir)
  }

  const start = async (resume?: string, dir?: string) => {
    const target = dir ?? cwd
    if (!target || busy) return
    setBusy(true)
    try {
      localStorage.setItem('aimux.cwd', target)
      await openSession(paneId, { cwd: target, resume, permissionMode: mode })
    } finally {
      setBusy(false)
    }
  }

  const label = (r: SDKSessionInfo) => r.customTitle || r.summary || r.firstPrompt || r.sessionId

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="drag h-10 shrink-0" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-6 py-8 fade-in">
          <h1 className="text-2xl font-semibold tracking-tight">Novi razgovor</h1>
          <p className="text-fg-muted mt-1.5">Odaberi radnu mapu u kojoj Claude Code radi.</p>

          {lastOpen.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center gap-2 text-xs font-medium text-fg-muted uppercase tracking-wider">
                <RotateCcw size={13} /> Nastavi gdje si stao
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {lastOpen.map((r) => (
                  <button key={r.sdkSessionId} onClick={() => start(r.sdkSessionId, r.cwd)} disabled={busy}
                    className="max-w-full px-3 py-1.5 rounded-full border border-border bg-bg-elev hover:bg-bg-elev2 text-[12.5px] truncate">
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block mt-7 text-xs font-medium text-fg-muted uppercase tracking-wider">Radna mapa</label>
          <div className="mt-2 flex gap-2">
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
              className="flex-1 bg-bg-elev border border-border rounded-lg px-3 py-2 font-mono text-[13px] outline-none focus:border-border-strong"
            />
            <button onClick={pick} className="px-3 py-2 rounded-lg border border-border bg-bg-elev hover:bg-bg-elev2 text-fg-muted hover:text-fg flex items-center gap-2 text-[13px]">
              <FolderOpen size={15} /> Odaberi
            </button>
          </div>

          <label className="block mt-6 text-xs font-medium text-fg-muted uppercase tracking-wider">Odobravanje alata</label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PERMISSION_MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`text-left px-3 py-2.5 rounded-lg border transition
                  ${mode === m.value ? 'border-accent bg-accent-soft/60' : 'border-border bg-bg-elev hover:bg-bg-elev2'}`}
              >
                <div className="text-[13px] font-medium">{m.label}</div>
                <div className="text-[11.5px] text-fg-muted mt-0.5">{m.hint}</div>
              </button>
            ))}
          </div>

          <button
            onClick={() => start()}
            disabled={!cwd || busy}
            className="mt-8 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-black font-medium hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100 transition"
          >
            Započni razgovor <ArrowRight size={16} />
          </button>

          <div className="mt-10">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-fg-muted uppercase tracking-wider">
                <History size={13} /> Prijašnje sesije
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-fg-muted cursor-pointer select-none">
                <input type="checkbox" checked={allDirs} onChange={(e) => setAllDirs(e.target.checked)} className="accent-accent" />
                sve mape
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2 bg-bg-elev border border-border rounded-lg px-3 h-9 focus-within:border-border-strong">
              <Search size={14} className="text-fg-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pretraži po naslovu ili prvoj poruci…"
                className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-fg-faint" />
            </div>
            <div className="mt-2 divide-y divide-border border border-border rounded-lg overflow-hidden">
              {filtered.length === 0 && <div className="px-3 py-4 text-[12.5px] text-fg-faint text-center">Nema sesija</div>}
              {filtered.slice(0, 30).map((r) => (
                <button
                  key={r.sessionId}
                  onClick={() => start(r.sessionId, r.cwd)}
                  disabled={busy}
                  className="w-full text-left px-3 py-2.5 hover:bg-bg-elev2 transition flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{label(r)}</div>
                    <div className="truncate text-[11px] text-fg-faint mt-0.5">
                      {new Date(r.lastModified).toLocaleString('hr-HR')}
                      {allDirs && r.cwd ? ` · ${r.cwd}` : ''}{r.gitBranch ? ` · ${r.gitBranch}` : ''}
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-fg-faint shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
