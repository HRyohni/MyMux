/// <reference lib="dom" />
// The round "quick questions" menu behind a long press on Ask mymux. Both the chat (renderer) and
// the browser-panel pages (src/preload/page.ts) open it, so it is plain DOM without React.

/** A question sent straight away from the pie menu. `name` is the wedge label, `text` what is sent. */
export interface QuickAsk { id: string; name: string; text: string }

export const DEFAULT_QUICK_ASKS: QuickAsk[] = [
  { id: 'explain', name: 'wtf is this', text: 'WTF is this? Explain it to me in short.' },
  { id: 'where', name: 'where can i see/test', text: 'Where can I see or test this?' },
]

export const MAX_QUICK_ASKS = 8
/** How long Ask mymux must be held before the pie opens; a shorter press is a normal click. */
export const HOLD_MS = 280

const R = 88
/** The cancel button in the middle. */
const CANCEL_R = 21
/** Transparent space between the wedges and around the cancel button, in pixels. */
const GAP = 5
const INNER = CANCEL_R + GAP
const LABEL_R = 58

/** Start of the first wedge's centre in degrees: two wedges read best side by side, more from the top. */
const firstAngle = (n: number) => (n === 2 ? 180 : -90)

/** Which wedge a point relative to the centre falls in; -1 inside the hole, which means "nothing". */
export function pieIndexAt(dx: number, dy: number, n: number): number {
  if (n <= 0 || Math.hypot(dx, dy) < INNER) return -1
  const step = 360 / n
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  return Math.floor((((deg - firstAngle(n) + step / 2) % 360) + 360) % 360 / step) % n
}

/** Breaks a label into at most `max` lines of `width` characters, ending in an ellipsis if it does not fit. */
export function pieLines(name: string, width: number, max: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of name.trim().split(/\s+/)) {
    if (cur && `${cur} ${word}`.length > width) { lines.push(cur); cur = word } else cur = cur ? `${cur} ${word}` : word
  }
  if (cur) lines.push(cur)
  const kept = lines.slice(0, max)
  const last = kept.length - 1
  if (last >= 0 && (lines.length > max || kept[last].length > width)) kept[last] = `${kept[last].slice(0, width - 1)}…`
  return kept
}

const polar = (radius: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return `${(radius * Math.cos(a)).toFixed(2)} ${(radius * Math.sin(a)).toFixed(2)}`
}

/** A ring segment; `gap` is cut in pixels, so the space between wedges stays even from hole to rim. */
function wedgePath(from: number, to: number, gap: number) {
  const trim = (radius: number) => (Math.asin(gap / 2 / radius) * 180) / Math.PI
  const [a0, a1, b0, b1] = [from + trim(R), to - trim(R), from + trim(INNER), to - trim(INNER)]
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${polar(INNER, b0)}L${polar(R, a0)}A${R} ${R} 0 ${large} 1 ${polar(R, a1)}L${polar(INNER, b1)}A${INNER} ${INNER} 0 ${large} 0 ${polar(INNER, b0)}Z`
}

const SVG = 'http://www.w3.org/2000/svg'

/** Geometry of the wedges. The tree is built by hand: pages with Trusted Types refuse innerHTML. */
export function pieWedges(names: string[]) {
  const n = names.length
  const step = 360 / n
  return names.map((name, i) => {
    const mid = firstAngle(n) + i * step
    // A single wedge is the whole ring; an exact 360 degree arc would draw nothing.
    const half = n === 1 ? 179.99 : step / 2
    const [x, y] = polar(n === 1 ? 0 : LABEL_R, mid).split(' ').map(Number)
    const lines = pieLines(name, n <= 4 ? 12 : 9, n <= 4 ? 3 : 2)
    const top = y - ((lines.length - 1) * 12) / 2 + 3.5
    return { name, path: wedgePath(mid - half, mid + half, n === 1 ? 0 : GAP), lines: lines.map((text, k) => ({ text, x, y: top + k * 12 })) }
  })
}

function pieSvg(names: string[]) {
  const make = (tag: string, attrs: Record<string, string | number> = {}) => {
    const node = document.createElementNS(SVG, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
    return node
  }
  const svg = make('svg', { class: 'pie', width: R * 2, height: R * 2, viewBox: `${-R} ${-R} ${R * 2} ${R * 2}` })
  for (const w of pieWedges(names)) {
    const g = make('g', { class: 'w' })
    const title = make('title')
    title.textContent = w.name
    const text = make('text')
    for (const l of w.lines) {
      const span = make('tspan', { x: l.x, y: l.y })
      span.textContent = l.text
      text.append(span)
    }
    g.append(title, make('path', { d: w.path }), text)
    svg.append(g)
  }
  const cancel = make('g', { class: 'c' })
  const title = make('title')
  title.textContent = 'Odustani'
  cancel.append(title, make('circle', { r: CANCEL_R }), make('path', { d: 'M-6 -6L6 6M6 -6L-6 6' }))
  svg.append(cancel)
  return svg
}

// Page stylesheets can define any custom property, so these names are ours and the page colours are the fallback.
const PIE_CSS = `
  .pie { display: block; overflow: visible; filter: drop-shadow(0 6px 16px rgba(0,0,0,.4)); animation: mymux-pie .12s ease-out; }
  @keyframes mymux-pie { from { opacity: 0; transform: scale(.8) } }
  .pie path { fill: var(--mymux-pie-bg, #161920); stroke: var(--mymux-pie-line, #343a47); stroke-width: 1; }
  .pie text { fill: var(--mymux-pie-fg, #e6e8ee); text-anchor: middle; pointer-events: none; font: 500 10.5px system-ui, -apple-system, "Segoe UI", sans-serif; }
  .pie .on path { fill: #d97757; }
  .pie .on text { fill: #000; }
  .pie .c circle { fill: var(--mymux-pie-bg, #161920); stroke: var(--mymux-pie-line, #343a47); stroke-width: 1; }
  .pie .c path { fill: none; stroke: var(--mymux-pie-fg, #e6e8ee); stroke-width: 2; stroke-linecap: round; }
  .pie .c.on circle { fill: #dc4a4a; stroke: #dc4a4a; }
  .pie .c.on path { stroke: #fff; }`

export interface PieOptions {
  /** Where the menu is attached; the page bubble keeps it inside its shadow root. */
  parent: Node
  x: number
  y: number
  names: string[]
  /** The area the menu must stay inside (the window by default). */
  bounds?: { left: number; top: number; right: number; bottom: number }
  onPick(index: number): void
  onClose(): void
}

/**
 * Opens the pie while the mouse button is still down. Releasing on a wedge picks it. Letting go
 * in the middle without having moved leaves the menu open for a normal click; dragging back to the
 * cancel button in the middle, clicking it or outside the menu, or Esc closes it.
 * Returns a function that closes it.
 */
export function openPie(o: PieOptions): () => void {
  const b = o.bounds ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  const fit = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(lo, v), hi))
  const cx = fit(o.x, b.left + R + 4, b.right - R - 4)
  const cy = fit(o.y, b.top + R + 4, b.bottom - R - 4)
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;left:${cx - R}px;top:${cy - R}px;z-index:2147483647;pointer-events:auto;user-select:none`
  // A constructed sheet, because a strict page CSP blocks <style> elements.
  const shadow = el.attachShadow({ mode: 'open' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(PIE_CSS)
  shadow.adoptedStyleSheets = [sheet]
  shadow.append(pieSvg(o.names))
  o.parent.appendChild(el)

  let held = true
  let cur = -1
  let leftMiddle = false
  const cancel = shadow.querySelector('.c')!
  const mark = (i: number) => {
    if (i === cur) return
    cur = i
    shadow.querySelectorAll('.w').forEach((w, k) => w.classList.toggle('on', k === i))
  }
  const at = (e: MouseEvent) => {
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    // While dragging only the direction counts, so an overshoot still lands on the wedge.
    return !held && Math.hypot(dx, dy) > R ? -1 : pieIndexAt(dx, dy, o.names.length)
  }
  const swallow = (e: Event) => { e.preventDefault(); e.stopPropagation() }
  const move = (e: MouseEvent) => {
    mark(at(e))
    if (cur >= 0) leftMiddle = true
    cancel.classList.toggle('on', cur < 0 && (leftMiddle || !held) && Math.hypot(e.clientX - cx, e.clientY - cy) < INNER)
  }
  const down = (e: MouseEvent) => {
    swallow(e)
    const i = e.button === 0 ? at(e) : -1
    if (i < 0) close()
    else mark(i)
  }
  const up = (e: MouseEvent) => {
    if (e.button !== 0) return
    swallow(e)
    if (cur < 0) {
      if (held && leftMiddle) close()
      held = false
      return
    }
    held = false
    const picked = cur
    close()
    o.onPick(picked)
  }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { swallow(e); close() } }
  const close = () => {
    el.remove()
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('mousedown', down, true)
    window.removeEventListener('mouseup', up, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    o.onClose()
  }
  window.addEventListener('mousemove', move, true)
  window.addEventListener('mousedown', down, true)
  window.addEventListener('mouseup', up, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
  return close
}
