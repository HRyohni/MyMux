/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/**
 * Preload of the browser panel's pages: when the user selects text, a small bubble offers
 * "Ask mymux" (quote it into the chat) and "Google it". It lives in the isolated world inside a
 * closed shadow root, so the page can neither style it nor fake a click on it.
 */

const MAX = 20000

let host: HTMLElement | null = null
let bubble: HTMLElement | null = null
let text = ''

function build() {
  host = document.createElement('mymux-selection')
  host.style.cssText = 'all:initial;position:fixed;inset:0 auto auto 0;z-index:2147483647;pointer-events:none'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      .b { position: fixed; display: none; gap: 2px; padding: 3px; border-radius: 10px; pointer-events: auto;
        background: #161920; border: 1px solid #343a47; box-shadow: 0 6px 20px rgba(0,0,0,.35);
        font: 500 12.5px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #e6e8ee; user-select: none; }
      button { all: unset; display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 7px; cursor: pointer; white-space: nowrap; }
      button:hover { background: #1d212b; }
      svg { width: 13px; height: 13px; flex: none; }
      .ask svg { color: #d97757; }
    </style>
    <div class="b">
      <button class="ask" data-action="ask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>Ask mymux</button>
      <button data-action="google"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>Google it</button>
    </div>`
  bubble = root.querySelector('.b')
  // Keep the selection alive while the bubble is clicked.
  bubble!.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
  bubble!.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest('button')
    if (!e.isTrusted || !btn || !text) return
    ipcRenderer.send('page:selection', btn.dataset.action, text)
    hide()
    window.getSelection()?.removeAllRanges()
  })
  document.documentElement.appendChild(host)
}

function hide() {
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

// Wait for the mouse/keyboard to finish the selection instead of following every change.
const onBubble = (e: Event) => !!host && e.target === host
window.addEventListener('mouseup', (e) => { if (e.button === 0 && !onBubble(e)) setTimeout(show, 0) }, true)
window.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && e.key === 'a')) show() }, true)
window.addEventListener('mousedown', (e) => { if (!onBubble(e)) hide() }, true)
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide() }, true)
window.addEventListener('scroll', () => hide(), true)
window.addEventListener('resize', () => hide())
document.addEventListener('selectionchange', () => { if (text && !window.getSelection()?.toString().trim()) hide() })
