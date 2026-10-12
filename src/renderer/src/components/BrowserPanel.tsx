import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, RotateCw, FileUp, X, Globe, Loader2, Plus, Search, ZoomIn, ZoomOut, Bug, ChevronUp, ChevronDown,
  Download, FolderOpen, FolderTree,
} from 'lucide-react'
import FileTree from './FileTree'
import { useStore } from '../store'
import { useSettings } from '../settings'
import { useWindowControlsInset } from '../hooks'
import type { DownloadInfo } from '../../../shared/ipc'

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`)

function DownloadRow({ d }: { d: DownloadInfo }) {
  const api = window.aimux.browser
  const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : null
  const status = d.state === 'progressing' ? (pct !== null ? `${pct}% od ${mb(d.total)}` : mb(d.received))
    : d.state === 'completed' ? mb(d.received)
    : d.state === 'cancelled' ? 'otkazano' : 'prekinuto'
  const done = d.state === 'completed'
  return (
    <div className="flex items-center gap-2 px-2 h-7 text-[12px] min-w-0">
      {d.state === 'progressing' ? <Loader2 size={13} className="shrink-0 animate-spin text-fg-muted" /> : <Download size={13} className={`shrink-0 ${done ? 'text-ok' : 'text-danger'}`} />}
      <button disabled={!done} onClick={() => void api.openPath(d.path)} title={done ? `Otvori ${d.path}` : d.path}
        className="truncate text-left enabled:hover:underline">{d.filename}</button>
      <span className="text-fg-faint shrink-0">{status}</span>
      {done && <button onClick={() => void api.showInFolder(d.path)} title="Prikaži u mapi" className="shrink-0 text-fg-muted hover:text-fg"><FolderOpen size={13} /></button>}
    </div>
  )
}

/**
 * Chrome around the embedded WebContentsView. The page itself is drawn by Electron on top of
 * the placeholder div; this component only measures the placeholder and reports its bounds.
 */
export default function BrowserPanel({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.sessions[sessionId]?.browser)
  const downloads = useStore((s) => s.sessions[sessionId]?.downloads)
  const findOpen = useStore((s) => !!s.sessions[sessionId]?.browserFindOpen)
  const overlay = useStore((s) => s.overlays > 0)
  const setBrowserOpen = useStore((s) => s.setBrowserOpen)
  const setFindOpen = useStore((s) => s.setBrowserFindOpen)
  const clearDownloads = useStore((s) => s.clearDownloads)
  const uiZoom = useSettings((s) => s.zoom)
  const holder = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const controlsInset = useWindowControlsInset(barRef)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ matches: number; active: number } | null>(null)
  const [treeOpen, setTreeOpen] = useState(false)
  const cwd = useStore((s) => s.sessions[sessionId]?.meta.cwd)
  const api = window.aimux.browser

  useEffect(() => { if (!editing) setDraft(state?.url ?? '') }, [state?.url, editing])

  useEffect(() => {
    const el = holder.current
    if (!el) return
    let last = ''
    const report = () => {
      const r = el.getBoundingClientRect()
      // The native view is positioned in window pixels, the DOM measures in zoomed CSS pixels.
      const z = uiZoom
      const b = { x: Math.round(r.left * z), y: Math.round(r.top * z), width: Math.round(r.width * z), height: Math.round(r.height * z) }
      const key = `${b.x},${b.y},${b.width},${b.height}`
      if (key === last) return
      last = key
      void api.setBounds(sessionId, b)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    const timer = setInterval(report, 250) // position changes (split drag) do not fire ResizeObserver
    return () => {
      ro.disconnect()
      clearInterval(timer)
      window.removeEventListener('resize', report)
    }
  }, [sessionId, uiZoom, api])

  // The native view covers any DOM drawn over it, so it steps aside while a dialog is open.
  useEffect(() => {
    void api.setVisible(sessionId, !overlay)
    return () => { void api.setVisible(sessionId, false) }
  }, [sessionId, overlay, api])

  useEffect(() => api.onFind((r) => { if (r.sessionId === sessionId) setFound({ matches: r.matches, active: r.active }) }), [sessionId, api])

  useEffect(() => {
    if (!findOpen) { setFound(null); void api.stopFind(sessionId); return }
    if (query) void api.find(sessionId, query, true, false)
    else { setFound(null); void api.stopFind(sessionId) }
  }, [findOpen, query, sessionId, api])

  const go = () => {
    const u = draft.trim()
    setEditing(false)
    if (u) void api.navigate(sessionId, u)
  }

  const btn = 'w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-30 disabled:hover:bg-transparent'
  const small = 'w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-30'
  const tabs = state?.tabs ?? []
  const zoom = state?.zoom ?? 1

  return (
    <div className="flex flex-col h-full bg-bg-elev border-l border-border">
      <div ref={barRef} className="drag h-10 shrink-0 flex items-center gap-1 px-2 border-b border-border" style={{ paddingRight: controlsInset + 8 }}>
        <div className="no-drag flex items-center gap-0.5">
          <button className={btn} disabled={!state?.canGoBack} onClick={() => void api.back(sessionId)} title="Natrag"><ArrowLeft size={15} /></button>
          <button className={btn} disabled={!state?.canGoForward} onClick={() => void api.forward(sessionId)} title="Naprijed"><ArrowRight size={15} /></button>
          <button className={btn} onClick={() => void api.reload(sessionId)} title="Osvježi">
            {state?.loading ? <Loader2 size={15} className="animate-spin" /> : <RotateCw size={14} />}
          </button>
        </div>
        <div className="no-drag flex-1 min-w-0 flex items-center gap-2 bg-bg border border-border rounded-md px-2 h-7 focus-within:border-border-strong">
          <Globe size={13} className="text-fg-faint shrink-0" />
          <input
            value={draft}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { setEditing(false); (e.target as HTMLInputElement).blur() } }}
            placeholder="Upiši URL ili otvori datoteku"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-mono placeholder:text-fg-faint"
          />
        </div>
        <div className="no-drag flex items-center gap-0.5">
          <button className={btn} onClick={() => void api.openFile(sessionId)} title="Otvori datoteku (PDF, DOCX, PPTX, slika…)"><FileUp size={15} /></button>
          <button className={btn} onClick={() => setBrowserOpen(sessionId, false)} title="Zatvori panel"><X size={15} /></button>
        </div>
      </div>

      <div className="h-8 shrink-0 flex items-center gap-1 pl-2 pr-1 border-b border-border min-w-0">
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <div key={t.id} onClick={() => void api.selectTab(sessionId, t.id)} title={t.url || 'Prazan tab'}
              onAuxClick={(e) => { if (e.button === 1) void api.closeTab(sessionId, t.id) }}
              className={`group/tab shrink-0 max-w-40 h-6 pl-2 pr-1 flex items-center gap-1 rounded-md text-[11.5px] cursor-pointer select-none border
                ${t.id === state?.activeTab ? 'bg-bg-elev2 text-fg border-border-strong' : 'text-fg-muted border-transparent hover:bg-bg-elev2/60'}`}>
              {t.loading && <Loader2 size={10} className="shrink-0 animate-spin" />}
              <span className="truncate">{t.title || t.url || 'Novi tab'}</span>
              <button onClick={(e) => { e.stopPropagation(); void api.closeTab(sessionId, t.id) }} title="Zatvori tab (Ctrl+W)"
                className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-fg-faint hover:text-danger opacity-0 group-hover/tab:opacity-100"><X size={10} /></button>
            </div>
          ))}
          <button className={small} onClick={() => void api.newTab(sessionId)} title="Novi tab (Ctrl+T)"><Plus size={13} /></button>
        </div>
        <button className={`${small} ${treeOpen ? 'text-accent' : ''}`} onClick={() => setTreeOpen(!treeOpen)} title="Datoteke radne mape"><FolderTree size={13} /></button>
        <button className={small} onClick={() => void api.setZoom(sessionId, zoom - 0.1)} title="Smanji (Ctrl+-)"><ZoomOut size={13} /></button>
        <button onClick={() => void api.setZoom(sessionId, 1)} title="Vrati na 100% (Ctrl+0)"
          className="shrink-0 w-9 text-[11px] tabular-nums text-fg-muted hover:text-fg">{Math.round(zoom * 100)}%</button>
        <button className={small} onClick={() => void api.setZoom(sessionId, zoom + 0.1)} title="Povećaj (Ctrl++)"><ZoomIn size={13} /></button>
        <button className={`${small} ${findOpen ? 'text-accent' : ''}`} onClick={() => setFindOpen(sessionId, !findOpen)} title="Pretraži stranicu (Ctrl+F)"><Search size={13} /></button>
        <button className={small} onClick={() => void api.devTools(sessionId)} title="DevTools (F12)"><Bug size={13} /></button>
      </div>

      {findOpen && (
        <div className="h-8 shrink-0 flex items-center gap-1.5 px-2 border-b border-border">
          <Search size={12} className="text-fg-faint shrink-0" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query) void api.find(sessionId, query, !e.shiftKey, true)
              if (e.key === 'Escape') setFindOpen(sessionId, false)
            }}
            placeholder="Pretraži stranicu…" spellCheck={false}
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] placeholder:text-fg-faint" />
          <span className="text-[11px] text-fg-faint tabular-nums shrink-0">{query && found ? (found.matches ? `${found.active} / ${found.matches}` : 'nema rezultata') : ''}</span>
          <button className={small} disabled={!query} onClick={() => void api.find(sessionId, query, false, true)} title="Prethodni (Shift+Enter)"><ChevronUp size={13} /></button>
          <button className={small} disabled={!query} onClick={() => void api.find(sessionId, query, true, true)} title="Sljedeći (Enter)"><ChevronDown size={13} /></button>
          <button className={small} onClick={() => setFindOpen(sessionId, false)} title="Zatvori (Esc)"><X size={13} /></button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {treeOpen && cwd && (
          <div className="w-52 shrink-0 border-r border-border bg-bg-elev">
            <FileTree cwd={cwd} onOpen={(path) => void api.openFile(sessionId, path)} />
          </div>
        )}
        <div ref={holder} className="flex-1 min-w-0 relative">
          {!state?.url && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-fg-faint text-[13px] gap-2 select-none">
              <Globe size={28} strokeWidth={1.2} />
              <div>Browser panel</div>
              <div className="text-[11.5px] text-center max-w-xs">Claude ovdje otvara web stranice i dokumente. Možeš i sam upisati URL ili otvoriti PDF.</div>
            </div>
          )}
        </div>
      </div>

      {downloads && downloads.length > 0 && (
        <div className="shrink-0 border-t border-border max-h-28 overflow-y-auto">
          <div className="flex items-center px-2 h-6 text-[10.5px] uppercase tracking-wider text-fg-faint">
            <span className="flex-1">Preuzimanja · mapa Preuzimanja</span>
            <button onClick={() => clearDownloads(sessionId)} className="hover:text-fg normal-case tracking-normal">očisti</button>
          </div>
          {[...downloads].reverse().map((d) => <DownloadRow key={d.id} d={d} />)}
        </div>
      )}
    </div>
  )
}
