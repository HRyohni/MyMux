/// <reference lib="dom" />
import { ipcRenderer } from 'electron'
import { HOLD_MS, openPie } from '../shared/pie'
import type { PickedElement } from '../shared/ipc'

/**
 * Preload of the browser panel's pages. When the user selects text, a small bubble offers
 * "Ask mymux" (quote it into the chat; held down, a pie of quick questions) and "Google it".
 * It also draws the element picker that references a part of the page in the chat. All of it lives
 * in the isolated world inside a closed shadow root, so the page can neither style it nor fake a click on it.
 */

const MAX = 20000
const MAX_HTML = 1500

type Quick = { id: string; name: string }

let host: HTMLElement | null = null
let root: ShadowRoot | null = null
let bubble: HTMLElement | null = null
let catcher: HTMLElement | null = null
let box: HTMLElement | null = null
let boxTag: HTMLElement | null = null
let text = ''
let closePie: (() => void) | null = null
let holdTimer: ReturnType<typeof setTimeout> | undefined

const STYLES = `
  .b { position: fixed; display: none; gap: 2px; padding: 3px; border-radius: 10px; pointer-events: auto;
    background: #161920; border: 1px solid #343a47; box-shadow: 0 6px 20px rgba(0,0,0,.35);
    font: 500 12.5px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e6e8ee; user-select: none; }
  button { all: unset; display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
  button:hover { background: #1d212b; }
  svg { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .ask svg { color: #d97757; }
  .catch { position: fixed; inset: 0; display: none; pointer-events: auto; cursor: crosshair; }
  .box { position: fixed; display: none; box-sizing: border-box; pointer-events: none; border: 2px solid #d97757; border-radius: 3px; background: rgba(217,119,87,.14); }
  .tag { position: absolute; left: -2px; bottom: 100%; margin-bottom: 4px; max-width: 320px; padding: 3px 6px; border-radius: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    background: #d97757; color: #000; font: 500 11px/1.2 ui-monospace, Consolas, monospace; }
  .box.low .tag { bottom: auto; top: 100%; margin: 4px 0 0; }`

function div(className: string, parent: Node) {
  const el = document.createElement('div')
  el.className = className
  parent.appendChild(el)
  return el
}

function actionButton(action: string, label: string, shapes: [string, Record<string, string>][], parent: Node) {
  const btn = document.createElement('button')
  btn.dataset.action = action
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v)
    svg.append(shape)
  }
  btn.append(svg, label)
  parent.appendChild(btn)
  return btn
}

function build() {
  host = document.createElement('mymux-selection')
  host.style.cssText = 'all:initial;position:fixed;inset:0 auto auto 0;z-index:2147483647;pointer-events:none'
  root = host.attachShadow({ mode: 'closed' })
  // Built by hand with a constructed sheet: pages with Trusted Types refuse innerHTML and a strict CSP blocks <style>.
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(STYLES)
  root.adoptedStyleSheets = [sheet]
  bubble = div('b', root)
  const ask = actionButton('ask', 'Ask mymux', [['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' }]], bubble)
  ask.className = 'ask'
  ask.title = 'Drži za brza pitanja'
  actionButton('google', 'Google it', [['circle', { cx: '11', cy: '11', r: '8' }], ['path', { d: 'm21 21-4.3-4.3' }]], bubble)
  catcher = div('catch', root)
  box = div('box', root)
  boxTag = div('tag', box)
  // Keep the selection alive while the bubble is clicked.
  bubble!.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.button === 0 && (e.target as Element).closest('[data-action="ask"]')) holdForPie(e)
  })
  bubble!.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('button')
    if (!e.isTrusted || !btn || !text || closePie) return
    ipcRenderer.send('page:selection', btn.dataset.action, text)
    hide()
    window.getSelection()?.removeAllRanges()
  })
  catcher!.addEventListener('mousemove', (e) => { if (!closePie) highlight(underPointer(e.clientX, e.clientY)) })
  catcher!.addEventListener('mousedown', pressElement)
  catcher!.addEventListener('wheel', scrollUnder, { passive: true })
  document.documentElement.appendChild(host)
}

/** Fetching the questions on each press keeps the pie current without any page ever holding them. */
function quickAsks(): Promise<Quick[]> {
  return ipcRenderer.invoke('page:quickAsks').catch(() => [])
}

/** Opens the pie if the mouse stays down long enough. */
function hold(e: MouseEvent, onHeld: () => void, onPick: (quick: Quick) => void) {
  const asks = quickAsks()
  const release = () => { clearTimeout(holdTimer); window.removeEventListener('mouseup', release, true) }
  window.addEventListener('mouseup', release, true)
  holdTimer = setTimeout(() => {
    window.removeEventListener('mouseup', release, true)
    void asks.then((list) => {
      if (list.length === 0) return
      onHeld()
      closePie = openPie({
        parent: root!, x: e.clientX, y: e.clientY, names: list.map((q) => q.name),
        onPick: (i) => onPick(list[i]),
        onClose: () => { closePie = null },
      })
    })
  }, HOLD_MS)
}

function holdForPie(e: MouseEvent) {
  const picked = text
  hold(e, () => { bubble!.style.display = 'none' }, (quick) => {
    ipcRenderer.send('page:selection', 'ask', picked, quick.id)
    hide()
    window.getSelection()?.removeAllRanges()
  })
}

function hide() {
  closePie?.()
  if (bubble) bubble.style.display = 'none'
  text = ''
}

function show() {
  const sel = window.getSelection()
  const picked = sel?.toString().trim() ?? ''
  if (!sel || sel.rangeCount === 0 || !picked) return hide()
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return hide()
  if (!host || !host.isConnected) build()
  text = picked.slice(0, MAX)
  const b = bubble!
  b.style.display = 'flex'
  const w = b.offsetWidth
  const h = b.offsetHeight
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8)
  const top = rect.top - h - 8 >= 4 ? rect.top - h - 8 : Math.min(rect.bottom + 8, window.innerHeight - h - 4)
  b.style.left = `${left}px`
  b.style.top = `${top}px`
}

// ---- element picker ---------------------------------------------------------

let picking = false
let hovered: Element | null = null
let pressed: Element | null = null

/** The topmost page element at a point, looking through open shadow roots. */
function underPointer(x: number, y: number): Element | null {
  let el = document.elementsFromPoint(x, y).find((n) => n !== host) ?? null
  while (el?.shadowRoot) {
    const inner: Element | undefined = el.shadowRoot.elementsFromPoint(x, y).find((n) => n !== el && el!.shadowRoot!.contains(n))
    if (!inner) break
    el = inner
  }
  return el
}

const shortTag = (el: Element) => {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []
  return [el.tagName.toLowerCase(), el.id ? `#${el.id}` : '', ...cls.map((c) => `.${c}`)].join('')
}

function highlight(el: Element | null) {
  hovered = el
  if (!el) { box!.style.display = 'none'; return }
  const r = el.getBoundingClientRect()
  box!.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`
  box!.classList.toggle('low', r.top < 28)
  boxTag!.textContent = `${shortTag(el)}  ${Math.round(r.width)}×${Math.round(r.height)}`
}

/** The catcher is over the whole page, so the wheel has to reach what is under it by hand. */
function scrollUnder(e: WheelEvent) {
  for (let n = hovered; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY
    if (n.scrollHeight > n.clientHeight && (y === 'auto' || y === 'scroll')) { n.scrollBy(0, e.deltaY); break }
    if (n === document.documentElement) { n.scrollBy(0, e.deltaY); break }
  }
  requestAnimationFrame(() => highlight(underPointer(e.clientX, e.clientY)))
}

/** A CSS selector that matches only this element, from the nearest thing with a stable name. */
function selectorOf(el: Element): string {
  const scope = el.getRootNode() as Document | ShadowRoot
  const unique = (sel: string) => { try { return scope.querySelectorAll(sel).length === 1 } catch { return false } }
  const stable = (n: Element) => {
    if (n.id && unique(`#${CSS.escape(n.id)}`)) return `#${CSS.escape(n.id)}`
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'name', 'aria-label']) {
      const v = n.getAttribute(attr)
      const sel = v && `${n.tagName.toLowerCase()}[${attr}="${CSS.escape(v)}"]`
      if (sel && unique(sel)) return sel
    }
    return ''
  }
  const parts: string[] = []
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    const name = stable(n)
    if (name) { parts.unshift(name); break }
    const tag = n.tagName.toLowerCase()
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n!.tagName) : []
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag)
    if (unique(parts.join(' > '))) break
  }
  return parts.join(' > ')
}

function describe(el: Element): PickedElement {
  const r = el.getBoundingClientRect()
  const html = el.outerHTML
  const label = (el as HTMLElement).innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || ''
  return {
    tag: shortTag(el),
    selector: selectorOf(el),
    text: label.replace(/\s+/g, ' ').trim().slice(0, 500),
    html: html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}…` : html,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
  }
}

function startPick() {
  if (picking) return
  if (!host || !host.isConnected) build()
  hide()
  picking = true
  catcher!.style.display = 'block'
}

function stopPick() {
  picking = false
  pressed = null
  clearTimeout(holdTimer)
  closePie?.()
  if (catcher) catcher.style.display = 'none'
  if (box) box.style.display = 'none'
}

function pressElement(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (!e.isTrusted) return
  if (e.button !== 0) { cancelPick(); return }
  const el = underPointer(e.clientX, e.clientY)
  if (!el) return
  pressed = el
  hold(e, () => { pressed = null }, (quick) => void finishPick(el, quick.id))
}

function cancelPick() {
  stopPick()
  ipcRenderer.send('page:pickEnd')
}

async function finishPick(el: Element, quickId?: string) {
  const data = describe(el)
  cancelPick()
  // The highlight must be off the screen before main takes the picture of the element.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  ipcRenderer.send('page:element', data, quickId)
}

ipcRenderer.on('page:pick', (_e, on: boolean) => { if (on) startPick(); else stopPick() })

// ---- wiring -----------------------------------------------------------------

// Wait for the mouse/keyboard to finish the selection instead of following every change.
const onBubble = (e: Event) => !!host && e.target === host
window.addEventListener('mouseup', (e) => {
  if (pressed && e.button === 0) { const el = pressed; pressed = null; void finishPick(el) }
  if (e.button === 0 && !onBubble(e) && !closePie && !picking) setTimeout(show, 0)
}, true)
window.addEventListener('keyup', (e) => { if (!picking && (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && e.key === 'a'))) show() }, true)
window.addEventListener('mousedown', (e) => { if (!onBubble(e)) hide() }, true)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (picking && !closePie) { e.preventDefault(); e.stopPropagation(); cancelPick() } else if (!closePie) hide()
}, true)
window.addEventListener('scroll', () => hide(), true)
window.addEventListener('resize', () => hide())
document.addEventListener('selectionchange', () => { if (text && !window.getSelection()?.toString().trim()) hide() })
