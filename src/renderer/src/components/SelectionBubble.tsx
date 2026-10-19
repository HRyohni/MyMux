import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { MessageCircle, Search } from 'lucide-react'
import { askAbout, googleIt } from '../actions'

/**
 * "Ask mymux" / "Google it" over text selected inside the container (the chat transcript).
 * Pages in the browser panel get the same bubble from src/preload/page.ts.
 */
export default function SelectionBubble({ sessionId, container }: { sessionId: string; container: RefObject<HTMLElement | null> }) {
  const [pos, setPos] = useState<{ left: number; top: number; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    const show = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!sel || sel.rangeCount === 0 || !text || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return setPos(null)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return setPos(null)
      setPos({ left: r.left + r.width / 2, top: r.top, text: text.slice(0, 20000) })
    }
    const onUp = (e: MouseEvent) => { if (e.button === 0 && !ref.current?.contains(e.target as Node)) setTimeout(show, 0) }
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
    el.addEventListener('scroll', hide)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onChange)
      el.removeEventListener('scroll', hide)
      window.removeEventListener('resize', hide)
    }
  }, [container])

  // Keep the bubble inside the window: above the selection, or below it near the top edge.
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 200, h: 32 })
  useLayoutEffect(() => {
    if (pos && ref.current) setBox({ w: ref.current.offsetWidth, h: ref.current.offsetHeight })
  }, [pos])
  if (!pos) return null
  const left = Math.min(Math.max(8, pos.left - box.w / 2), window.innerWidth - box.w - 8)
  const top = pos.top - box.h - 8 >= 4 ? pos.top - box.h - 8 : pos.top + 24

  const act = (fn: (sid: string, text: string) => void) => {
    fn(sessionId, pos.text)
    window.getSelection()?.removeAllRanges()
    setPos(null)
  }
  const btn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-bg-elev2 whitespace-nowrap'
  return (
    <div ref={ref} onMouseDown={(e) => e.preventDefault()} style={{ left, top }}
      className="fixed z-50 flex gap-0.5 p-[3px] rounded-[10px] border border-border-strong bg-bg-elev shadow-lg text-[12.5px] font-medium text-fg select-none fade-in">
      <button className={btn} onClick={() => act(askAbout)}><MessageCircle size={13} className="text-accent" /> Ask mymux</button>
      <button className={btn} onClick={() => act(googleIt)}><Search size={13} /> Google it</button>
    </div>
  )
}
