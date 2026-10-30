import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { MessageCircle, Search } from 'lucide-react'
import { googleIt, quoteSelection, sendQuickAsk } from '../actions'
import { useStore } from '../store'
import { useSettings } from '../settings'
import { HOLD_MS, openPie } from '../../../shared/pie'

/**
 * "Ask mymux" / "Google it" over text selected inside the container (the chat transcript); holding
 * Ask mymux opens the pie of quick questions. Pages in the browser panel get the same bubble from src/preload/page.ts.
 * `read` and `quote` let the code editor supply the exact selection and how it reads in a message.
 */
export default function SelectionBubble({ sessionId, container, read, quote = quoteSelection }: {
  sessionId: string; container: RefObject<HTMLElement | null>; read?(): string; quote?(text: string): string
}) {
  const [pos, setPos] = useState<{ left: number; top: number; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const closePie = useRef<(() => void) | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const show = () => {
      const sel = window.getSelection()
      const text = (read ? read() : sel?.toString())?.trim() ?? ''
      if (!sel || sel.rangeCount === 0 || !text || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return setPos(null)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return setPos(null)
      setPos({ left: r.left + r.width / 2, top: r.top, text: text.slice(0, 20000) })
    }
    const onUp = (e: MouseEvent) => { if (e.button === 0 && !closePie.current && !ref.current?.contains(e.target as Node)) setTimeout(show, 0) }
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPos(null) }
    const onKeyUp = (e: KeyboardEvent) => { if (e.shiftKey || e.key === 'Shift') show() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    const onChange = () => { if (!window.getSelection()?.toString().trim()) setPos(null) }
    const hide = () => setPos(null)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keyup', onKeyUp)
    document.addEventListener('keydown', onKey)
    document.addEventListener('selectionchange', onChange)
    // Capturing, because the editor scrolls an element inside the container.
    el.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onChange)
      el.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [container, read])

  useEffect(() => { if (!pos) closePie.current?.() }, [pos])
  useEffect(() => () => closePie.current?.(), [])

  // Keep the bubble inside the window: above the selection, or below it near the top edge.
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 200, h: 32 })
  useLayoutEffect(() => {
    if (pos && ref.current) setBox({ w: ref.current.offsetWidth, h: ref.current.offsetHeight })
  }, [pos])
  if (!pos) return null
  // Stays inside its panel too: a resize handle under the bubble would take its clicks.
  const area = container.current?.getBoundingClientRect()
  const left = Math.min(Math.max((area?.left ?? 0) + 8, pos.left - box.w / 2), (area?.right ?? window.innerWidth) - box.w - 8)
  const top = pos.top - box.h - 8 >= 4 ? pos.top - box.h - 8 : pos.top + 24

  const finish = () => {
    window.getSelection()?.removeAllRanges()
    setPos(null)
  }
  const act = (fn: (sid: string, text: string) => void) => {
    if (closePie.current) return
    fn(sessionId, pos.text)
    finish()
  }
  // A long press opens the pie; let go early and it stays a normal click.
  const press = (e: React.MouseEvent) => {
    const asks = useSettings.getState().quickAsks
    if (e.button !== 0 || asks.length === 0) return
    const { clientX: x, clientY: y } = e
    const release = () => { clearTimeout(timer); window.removeEventListener('mouseup', release, true) }
    const timer = setTimeout(() => {
      window.removeEventListener('mouseup', release, true)
      closePie.current = openPie({
        parent: document.body, x, y, names: asks.map((q) => q.name),
        // The native browser view would cover anything drawn over it, so the pie stays over the chat.
        bounds: container.current?.getBoundingClientRect(),
        onPick: (i) => { sendQuickAsk(sessionId, quote(pos.text), asks[i].id); finish() },
        onClose: () => { closePie.current = null },
      })
    }, HOLD_MS)
    window.addEventListener('mouseup', release, true)
  }
  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-bg-elev2 whitespace-nowrap'
  return (
    <div ref={ref} onMouseDown={(e) => e.preventDefault()} style={{ left, top }}
      className="fixed z-50 flex gap-0.5 p-[3px] rounded-[10px] border border-border-strong bg-bg-elev shadow-lg text-[12.5px] font-medium text-fg select-none fade-in">
      <button className={btn} onMouseDown={press} onClick={() => act((sid, text) => useStore.getState().appendDraft(sid, quote(text)))} title="Drži za brza pitanja"><MessageCircle size={13} className="text-accent" /> Ask mymux</button>
      <button className={btn} onClick={() => act(googleIt)}><Search size={13} /> Google it</button>
    </div>
  )
}
