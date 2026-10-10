import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, FileUp, X, Globe, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { useWindowControlsInset } from '../hooks'

/**
 * Chrome around the embedded WebContentsView. The page itself is drawn by Electron on top of
 * the placeholder div; this component only measures the placeholder and reports its bounds.
 */
export default function BrowserPanel({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s.sessions[sessionId]?.browser)
  const setBrowserOpen = useStore((s) => s.setBrowserOpen)
  const holder = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const controlsInset = useWindowControlsInset(barRef)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => { if (!editing) setDraft(state?.url ?? '') }, [state?.url, editing])

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const api = window.aimux.browser
    let last = ''
    const report = () => {
      const r = el.getBoundingClientRect()
      const b = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
      const key = `${b.x},${b.y},${b.width},${b.height}`
      if (key === last) return
      last = key
      void api.setBounds(sessionId, b)
    }
    report()
    void api.setVisible(sessionId, true)
    const ro = new ResizeObserver(report)
    ro.observe(el)
    window.addEventListener('resize', report)
    const timer = setInterval(report, 250) // position changes (split drag) do not fire ResizeObserver
    return () => {
      ro.disconnect()
      clearInterval(timer)
      window.removeEventListener('resize', report)
      void api.setVisible(sessionId, false)
    }
  }, [sessionId])

  const go = () => {
    const u = draft.trim()
    setEditing(false)
    if (u) void window.aimux.browser.navigate(sessionId, u)
  }

  const btn = 'w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div className="flex flex-col h-full bg-bg-elev border-l border-border">
      <div ref={barRef} className="drag h-10 shrink-0 flex items-center gap-1 px-2 border-b border-border" style={{ paddingRight: controlsInset + 8 }}>
        <div className="no-drag flex items-center gap-0.5">
          <button className={btn} disabled={!state?.canGoBack} onClick={() => void window.aimux.browser.back(sessionId)} title="Natrag"><ArrowLeft size={15} /></button>
          <button className={btn} disabled={!state?.canGoForward} onClick={() => void window.aimux.browser.forward(sessionId)} title="Naprijed"><ArrowRight size={15} /></button>
          <button className={btn} onClick={() => void window.aimux.browser.reload(sessionId)} title="Osvježi">
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
          <button className={btn} onClick={() => void window.aimux.browser.openFile(sessionId)} title="Otvori datoteku (PDF, slika…)"><FileUp size={15} /></button>
          <button className={btn} onClick={() => setBrowserOpen(sessionId, false)} title="Zatvori panel"><X size={15} /></button>
        </div>
      </div>
      <div ref={holder} className="flex-1 min-h-0 relative">
        {!state?.url && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-fg-faint text-[13px] gap-2 select-none">
            <Globe size={28} strokeWidth={1.2} />
            <div>Browser panel</div>
            <div className="text-[11.5px] text-center max-w-xs">Claude ovdje otvara web stranice i dokumente. Možeš i sam upisati URL ili otvoriti PDF.</div>
          </div>
        )}
      </div>
    </div>
  )
}
