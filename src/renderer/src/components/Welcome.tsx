import { useEffect, useMemo, useRef, useState } from 'react'
import { useWindowControlsInset } from '../hooks'
import { FolderOpen, History, ArrowRight, Search, RotateCcw, Star, X, Clock, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useStore, PERMISSION_MODES, readRecent, leaves, selectLayout, type RecentEntry } from '../store'
import { useSettings } from '../settings'
import { openSession, archiveStoredSession, deleteStoredSession, errText } from '../actions'
import type { SDKSessionInfo, PermissionMode, TranscriptHit } from '../../../shared/ipc'

const readList = (key: string): string[] => { try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] } }
const writeList = (key: string, v: string[]) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ } }
const FAV_KEY = 'aimux.favDirs'
const RECENT_DIRS_KEY = 'aimux.recentDirs'
const norm = (p: string) => p.trim().replace(/[\\/]+$/, '')
const shortName = (p: string) => { const parts = norm(p).split(/[\\/]/); return parts[parts.length - 1] || p }

export default function Welcome({ paneId }: { paneId: string }) {
  const [cwd, setCwd] = useState('')
  const [mode, setMode] = useState<PermissionMode>(() => useSettings.getState().defaultMode)
  const [showArchived, setShowArchived] = useState(false)
  const [reload, setReload] = useState(0)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [hits, setHits] = useState<TranscriptHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchContent = () => {
    if (q.trim().length < 2 || searching) return
    setSearching(true)
    setError('')
    window.aimux.searchTranscripts(q, allDirs ? undefined : cwd)
      .then(setHits)
      .catch((e) => setError(`Pretraga nije uspjela: ${errText(e)}`))
      .finally(() => setSearching(false))
  }
  const [recent, setRecent] = useState<SDKSessionInfo[]>([])
  const [allDirs, setAllDirs] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastOpen, setLastOpen] = useState<RecentEntry[]>([])
  const openSessions = useStore((s) => s.sessions)
  const topRef = useRef<HTMLDivElement>(null)
  const multi = useStore((s) => leaves(selectLayout(s)).length > 1)
  const closePane = useStore((s) => s.closePane)
  const controlsInset = useWindowControlsInset(topRef)
  const [favs, setFavs] = useState<string[]>(() => readList(FAV_KEY))
  const [recentDirs, setRecentDirs] = useState<string[]>(() => readList(RECENT_DIRS_KEY))
  const isFav = favs.some((f) => f.toLowerCase() === norm(cwd).toLowerCase())
  const toggleFav = () => {
    const c = norm(cwd)
    if (!c) return
    const next = isFav ? favs.filter((f) => f.toLowerCase() !== c.toLowerCase()) : [...favs, c]
    setFavs(next); writeList(FAV_KEY, next)
  }
  const removeFav = (dir: string) => { const next = favs.filter((f) => f !== dir); setFavs(next); writeList(FAV_KEY, next) }
  const quickDirs = [...favs, ...recentDirs.filter((d) => !favs.some((f) => f.toLowerCase() === d.toLowerCase()))]

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
  }, [cwd, allDirs, reload])

  const openIds = useMemo(() => new Set(Object.values(openSessions).map((s) => s.meta.sdkSessionId)), [openSessions])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return recent
      .filter((r) => !openIds.has(r.sessionId))
      .filter((r) => (r.tag === 'archived') === showArchived)
      .filter((r) => !needle || [r.customTitle, r.summary, r.firstPrompt, r.cwd].some((x) => x?.toLowerCase().includes(needle)))
  }, [recent, q, openIds, showArchived])

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
      const nextRecent = [norm(target), ...recentDirs.filter((d) => d.toLowerCase() !== norm(target).toLowerCase())].slice(0, 8)
      setRecentDirs(nextRecent); writeList(RECENT_DIRS_KEY, nextRecent)
      const { defaultModel, defaultEffort } = useSettings.getState()
      // A resumed session keeps the model it was using; the defaults apply to new conversations.
      await openSession(paneId, { cwd: target, resume, permissionMode: mode, ...(resume ? {} : { model: defaultModel || undefined, effort: defaultEffort || undefined }) })
    } catch (e) {
      setError(`Razgovor nije otvoren: ${errText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const label = (r: SDKSessionInfo) => r.customTitle || r.summary || r.firstPrompt || r.sessionId

  /** Runs a change to a stored session and refreshes the list. */
  const mutate = (what: string, fn: () => Promise<void>) => {
    setError('')
    fn().then(() => setReload((n) => n + 1)).catch((e) => setError(`${what}: ${errText(e)}`))
  }
  const commitRename = (r: SDKSessionInfo) => {
    const t = renaming?.text.trim()
    setRenaming(null)
    if (t && t !== label(r)) mutate('Preimenovanje nije uspjelo', () => window.aimux.renameStored(r.sessionId, t, r.cwd))
  }
  const rowBtn = 'w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg hover:bg-bg-elev'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div ref={topRef} className="h-10 shrink-0 flex">
        <div className="drag flex-1" />
        {multi && (
          <button onClick={() => closePane(paneId)} title="Zatvori panel (Ctrl+W)"
            className="no-drag shrink-0 self-center mr-1.5 w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-danger hover:bg-bg-elev2">
            <X size={15} />
          </button>
        )}
        <div className="no-drag shrink-0" style={{ width: controlsInset }} />
      </div>
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
            <button onClick={toggleFav} disabled={!cwd} title={isFav ? 'Ukloni iz omiljenih' : 'Dodaj u omiljene mape'}
              className={`w-10 rounded-lg border flex items-center justify-center transition disabled:opacity-40
                ${isFav ? 'border-accent/60 bg-accent-soft/60 text-accent' : 'border-border bg-bg-elev hover:bg-bg-elev2 text-fg-muted hover:text-fg'}`}>
              <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
            </button>
          </div>
          {quickDirs.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quickDirs.map((dir) => {
                const fav = favs.includes(dir)
                const active = norm(cwd).toLowerCase() === dir.toLowerCase()
                return (
                  <span key={dir} title={dir}
                    className={`group inline-flex items-center gap-1 pl-2 pr-1.5 h-7 rounded-full border text-[12px] transition
                      ${active ? 'border-accent/60 bg-accent-soft/50 text-fg' : 'border-border bg-bg-elev text-fg-muted hover:text-fg hover:bg-bg-elev2'}`}>
                    <button onClick={() => setCwd(dir)} className="flex items-center gap-1">
                      {fav ? <Star size={11} className="text-accent" fill="currentColor" /> : <Clock size={11} className="text-fg-faint" />}
                      {shortName(dir)}
                    </button>
                    {fav && (
                      <button onClick={() => removeFav(dir)} title="Ukloni" className="w-4 h-4 rounded-full flex items-center justify-center text-fg-faint hover:text-danger opacity-0 group-hover:opacity-100">
                        <X size={10} />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}

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
              <div className="flex items-center gap-3 text-[12px] text-fg-muted select-none">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-accent" />
                  arhivirane
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={allDirs} onChange={(e) => setAllDirs(e.target.checked)} className="accent-accent" />
                  sve mape
                </label>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 bg-bg-elev border border-border rounded-lg px-3 h-9 focus-within:border-border-strong">
              <Search size={14} className="text-fg-faint" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setHits(null) }} placeholder="Pretraži po naslovu ili prvoj poruci…"
                onKeyDown={(e) => { if (e.key === 'Enter') searchContent() }}
                className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-fg-faint" />
              <button onClick={searchContent} disabled={q.trim().length < 2 || searching} title="Pretraži i tekst poruka u transkriptima (Enter)"
                className="shrink-0 text-[11.5px] text-fg-muted hover:text-fg disabled:opacity-40">{searching ? 'tražim…' : 'u sadržaju'}</button>
            </div>
            {hits && (
              <div className="mt-2 border border-accent/40 rounded-lg overflow-hidden divide-y divide-border">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-fg-faint bg-bg-elev">Pronađeno u sadržaju ({hits.length})</div>
                {hits.length === 0 && <div className="px-3 py-3 text-[12.5px] text-fg-faint text-center">Nijedna poruka ne sadrži taj tekst.</div>}
                {hits.map((h) => (
                  <button key={h.sessionId} onClick={() => start(h.sessionId, h.cwd ?? cwd)} disabled={busy || openIds.has(h.sessionId)}
                    className="w-full text-left px-3 py-2 hover:bg-bg-elev2 disabled:opacity-50">
                    <div className="truncate text-[13px]">{h.title}{openIds.has(h.sessionId) ? ' (već otvoren)' : ''}</div>
                    <div className="text-[12px] text-fg-muted mt-0.5 line-clamp-2">{h.snippet}</div>
                    <div className="truncate text-[11px] text-fg-faint mt-0.5">{new Date(h.lastModified).toLocaleString('hr-HR')}{h.cwd ? ` · ${h.cwd}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 divide-y divide-border border border-border rounded-lg overflow-hidden">
              {filtered.length === 0 && <div className="px-3 py-4 text-[12.5px] text-fg-faint text-center">{showArchived ? 'Nema arhiviranih sesija' : 'Nema sesija'}</div>}
              {filtered.slice(0, 30).map((r) => (
                <div key={r.sessionId} className="group/row px-3 py-2.5 hover:bg-bg-elev2 transition flex items-center gap-2">
                  {renaming?.id === r.sessionId ? (
                    <input autoFocus value={renaming.text} onChange={(e) => setRenaming({ id: r.sessionId, text: e.target.value })}
                      onBlur={() => commitRename(r)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(r); if (e.key === 'Escape') setRenaming(null) }}
                      className="flex-1 min-w-0 h-8 px-2 rounded-md bg-bg border border-accent text-[13px] outline-none" />
                  ) : (
                    <button onClick={() => start(r.sessionId, r.cwd)} disabled={busy} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[13px]">{label(r)}</div>
                      <div className="truncate text-[11px] text-fg-faint mt-0.5">
                        {new Date(r.lastModified).toLocaleString('hr-HR')}
                        {allDirs && r.cwd ? ` · ${r.cwd}` : ''}{r.gitBranch ? ` · ${r.gitBranch}` : ''}
                      </div>
                    </button>
                  )}
                  <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
                    <button className={rowBtn} title="Preimenuj" onClick={() => setRenaming({ id: r.sessionId, text: label(r) })}><Pencil size={13} /></button>
                    <button className={rowBtn} title={showArchived ? 'Vrati iz arhive' : 'Arhiviraj (sakrij s popisa)'}
                      onClick={() => mutate('Arhiviranje nije uspjelo', () => archiveStoredSession(r.sessionId, r.cwd, !showArchived))}>
                      {showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    </button>
                    {confirmDelete === r.sessionId ? (
                      <button onBlur={() => setConfirmDelete(null)} autoFocus
                        onClick={() => { setConfirmDelete(null); mutate('Brisanje nije uspjelo', () => deleteStoredSession(r.sessionId, r.cwd)) }}
                        className="h-6 px-2 rounded-md bg-danger text-white text-[11px]">Obriši trajno?</button>
                    ) : (
                      <button className={`${rowBtn} hover:text-danger`} title="Obriši transkript" onClick={() => setConfirmDelete(r.sessionId)}><Trash2 size={13} /></button>
                    )}
                  </div>
                  <ArrowRight size={14} className="text-fg-faint shrink-0" />
                </div>
              ))}
            </div>
            {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
