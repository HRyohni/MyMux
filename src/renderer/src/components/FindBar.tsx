import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X, Search } from 'lucide-react'

const ALL = 'aimux-find'
const CURRENT = 'aimux-find-current'

/**
 * The ::highlight() rules are added at runtime: the CSS minifier of the build does not know the
 * pseudo-element yet and drops rules that use it.
 */
function ensureStyle() {
  if (document.getElementById('aimux-find-style')) return
  const el = document.createElement('style')
  el.id = 'aimux-find-style'
  el.textContent = `::highlight(${ALL}){background:color-mix(in srgb,var(--color-warn) 35%,transparent)}`
    + `::highlight(${CURRENT}){background:var(--color-accent);color:#000}`
  document.head.append(el)
}

/** Ranges of every case-insensitive occurrence of `needle` in the rendered text under `root`. */
function findRanges(root: HTMLElement, needle: string): Range[] {
  const out: Range[] = []
  const q = needle.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node && out.length < 2000; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase()
    for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
      const r = document.createRange()
      r.setStart(node, at)
      r.setEnd(node, at + q.length)
      out.push(r)
    }
  }
  return out
}

/**
 * Search within the rendered conversation. Matches are painted with the CSS Custom Highlight API,
 * so the message DOM is left untouched. Collapsed tool cards are searched once expanded.
 */
export default function FindBar({ container, version, onClose }: {
  container: React.RefObject<HTMLElement | null>
  /** Changes whenever the conversation content does, so matches are recomputed. */
  version: unknown
  onClose(): void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [ranges, setRanges] = useState<Range[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { ensureStyle(); input.current?.focus(); input.current?.select() }, [])

  useEffect(() => {
    const root = container.current
    if (!root || !query) { setRanges([]); return }
    // Wait a frame so freshly rendered messages are in the DOM.
    const raf = requestAnimationFrame(() => setRanges(findRanges(root, query)))
    return () => cancelAnimationFrame(raf)
  }, [query, version, container])

  useEffect(() => { setIndex(0) }, [query])

  useEffect(() => {
    if (ranges.length === 0) { CSS.highlights.delete(ALL); CSS.highlights.delete(CURRENT); return }
    const cur = ranges[Math.min(index, ranges.length - 1)]
    CSS.highlights.set(ALL, new Highlight(...ranges))
    CSS.highlights.set(CURRENT, new Highlight(cur))
    cur.startContainer.parentElement?.scrollIntoView({ block: 'center' })
  }, [ranges, index])

  useEffect(() => () => { CSS.highlights.delete(ALL); CSS.highlights.delete(CURRENT) }, [])

  const step = (d: number) => { if (ranges.length) setIndex((i) => (Math.min(i, ranges.length - 1) + d + ranges.length) % ranges.length) }
  const btn = 'w-6 h-6 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 disabled:opacity-30'

  return (
    <div className="shrink-0 flex items-center gap-1.5 px-3 h-9 border-b border-border bg-bg-elev">
      <Search size={13} className="text-fg-faint shrink-0" />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        placeholder="Pretraži razgovor…"
        spellCheck={false}
        className="flex-1 min-w-0 bg-transparent outline-none text-[13px] placeholder:text-fg-faint"
      />
      <span className="text-[11.5px] text-fg-faint tabular-nums shrink-0">
        {query ? (ranges.length ? `${Math.min(index, ranges.length - 1) + 1} / ${ranges.length}` : 'nema rezultata') : ''}
      </span>
      <button className={btn} disabled={!ranges.length} onClick={() => step(-1)} title="Prethodni (Shift+Enter)"><ChevronUp size={14} /></button>
      <button className={btn} disabled={!ranges.length} onClick={() => step(1)} title="Sljedeći (Enter)"><ChevronDown size={14} /></button>
      <button className={btn} onClick={onClose} title="Zatvori (Esc)"><X size={14} /></button>
    </div>
  )
}
