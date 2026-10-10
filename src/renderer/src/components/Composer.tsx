import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, RotateCcw } from 'lucide-react'
import { useStore } from '../store'
import { openSession } from './Welcome'

export default function Composer({ sessionId, paneId }: { sessionId: string; paneId: string }) {
  const meta = useStore((s) => s.sessions[sessionId]?.meta)
  const removeSession = useStore((s) => s.removeSession)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { ref.current?.focus() }, [sessionId])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }, [text])

  if (!meta) return null
  const running = meta.running

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    await window.aimux.send(sessionId, t)
  }

  const stop = () => { void window.aimux.interrupt(sessionId) }

  const resume = async () => {
    if (!meta.sdkSessionId || busy) return
    setBusy(true)
    try {
      await window.aimux.closeSession(sessionId)
      removeSession(sessionId)
      await openSession(paneId, { cwd: meta.cwd, resume: meta.sdkSessionId, permissionMode: meta.permissionMode })
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  if (meta.ended) {
    return (
      <div className="shrink-0 px-6 pb-5 pt-2">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border bg-bg-elev px-4 py-3 flex items-center gap-3 text-[13px] text-fg-muted">
          <span className="flex-1">Sesija je završila. Možeš je nastaviti s cijelom poviješću.</span>
          <button onClick={() => void resume()} disabled={!meta.sdkSessionId || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-black font-medium hover:brightness-110 disabled:opacity-50">
            <RotateCcw size={14} /> Nastavi
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-bg-elev focus-within:border-border-strong transition px-3 py-2">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            placeholder={running ? 'Možeš pisati i dok Claude radi…' : 'Napiši poruku…'}
            className="flex-1 resize-none bg-transparent outline-none text-[14.5px] leading-relaxed py-1.5 placeholder:text-fg-faint max-h-60"
          />
          {running ? (
            <button onClick={stop} title="Zaustavi" className="shrink-0 w-8 h-8 rounded-full bg-bg-elev2 border border-border text-fg hover:text-danger flex items-center justify-center">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button onClick={() => void send()} disabled={!text.trim()} title="Pošalji (Enter)"
              className="shrink-0 w-8 h-8 rounded-full bg-accent text-black disabled:opacity-30 flex items-center justify-center hover:brightness-110 transition">
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
        <div className="text-center text-[11px] text-fg-faint mt-2">Enter šalje · Shift+Enter novi red</div>
      </div>
    </div>
  )
}
