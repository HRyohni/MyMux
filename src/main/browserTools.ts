import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { SessionBrowser } from './browser'

const MAX_TEXT = 12000

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? s.slice(0, n) + `\n… (skraćeno, ukupno ${s.length} znakova)` : s)

/** Runs in the page: tags visible interactive elements with refs and lists them. */
const SNAPSHOT_SCRIPT = `(() => {
  const sel = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [contenteditable="true"], [onclick]';
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.alt || el.title || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  document.querySelectorAll('[data-mymux-ref]').forEach((el) => el.removeAttribute('data-mymux-ref'));
  const out = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue;
    n++; const ref = 'e' + n; el.setAttribute('data-mymux-ref', ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'input' ? (el.type || 'text') : tag);
    let line = '[' + ref + '] ' + role + ' "' + label(el) + '"';
    if (tag === 'a' && el.href) line += ' -> ' + el.href.slice(0, 120);
    if ((tag === 'input' || tag === 'textarea') && el.value) line += ' value="' + String(el.value).slice(0, 60) + '"';
    if (el.checked) line += ' [checked]';
    if (el.disabled) line += ' [disabled]';
    out.push(line);
    if (n >= 200) { out.push('… (više od 200 elemenata, prikazano prvih 200)'); break; }
  }
  return out.join('\\n');
})()`

/** Builds the per-session MCP server that exposes the visible browser panel to Claude. */
export function createBrowserTools(b: SessionBrowser, onActivity: () => void, extraTools: NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']> = []) {
  const ref = (r: string) => `[data-mymux-ref="${r}"]`
  const act = <T,>(fn: () => Promise<T>) => { onActivity(); return fn() }

  const tools = [
    tool('browser_navigate', 'Otvori URL u browser panelu koji korisnik vidi. Vraća naslov i kratki snapshot.',
      { url: z.string().describe('Puni URL ili domena') },
      (a) => act(async () => {
        await b.navigate(a.url)
        await b.waitSettled()
        return text(await snapshot())
      })),

    tool('browser_open_file', 'Otvori lokalnu datoteku (PDF, slika, HTML, tekst) u browser panelu da je korisnik vidi.',
      { path: z.string().describe('Apsolutna putanja ili relativna prema radnoj mapi') },
      (a) => act(async () => {
        await b.openFile(a.path)
        await b.waitSettled()
        const s = b.state()
        return text(`Otvoreno: ${s.url}\nNaslov: ${s.title || '(bez naslova)'}`)
      })),

    tool('browser_snapshot', 'Trenutni URL, naslov i popis vidljivih interaktivnih elemenata s referencama (e1, e2…) za klik/upis, plus struktura stranice.',
      {},
      () => act(async () => text(await snapshot()))),

    tool('browser_get_text', 'Vrati vidljivi tekst stranice (innerText), skraćen.',
      { maxChars: z.number().int().min(500).max(60000).optional() },
      (a) => act(async () => {
        const p = await b.getPage()
        const t = await p.evaluate("document.body ? document.body.innerText : ''") as string
        return text(clip(t, a.maxChars ?? MAX_TEXT))
      })),

    tool('browser_click', 'Klikni element po referenci iz snapshota (npr. "e12"). Nakon navigacije reference zastarijevaju, napravi novi snapshot.',
      { ref: z.string() },
      (a) => act(async () => {
        const p = await b.getPage()
        await p.click(ref(a.ref))
        await b.waitSettled(1000)
        return text(await snapshot())
      })),

    tool('browser_type', 'Upiši tekst u polje po referenci. Opcionalno pritisni Enter nakon upisa.',
      { ref: z.string(), text: z.string(), submit: z.boolean().optional() },
      (a) => act(async () => {
        const p = await b.getPage()
        await p.fill(ref(a.ref), a.text)
        if (a.submit) { await p.press(ref(a.ref), 'Enter'); await b.waitSettled(1000) }
        return text(`Upisano u ${a.ref}${a.submit ? ' i poslano' : ''}.`)
      })),

    tool('browser_select', 'Odaberi opciju u <select> elementu po referenci (vrijednost ili vidljivi tekst).',
      { ref: z.string(), value: z.string() },
      (a) => act(async () => {
        const p = await b.getPage()
        await p.selectOption(ref(a.ref), { label: a.value }).catch(() => p.selectOption(ref(a.ref), a.value))
        return text(`Odabrano "${a.value}" u ${a.ref}.`)
      })),

    tool('browser_press', 'Pritisni tipku na stranici (npr. "Enter", "Escape", "PageDown", "Control+f").',
      { key: z.string() },
      (a) => act(async () => {
        const p = await b.getPage()
        await p.keyboard.press(a.key)
        return text(`Pritisnuto ${a.key}.`)
      })),

    tool('browser_scroll', 'Skrolaj stranicu gore ili dolje za zadani broj piksela (zadano 600).',
      { direction: z.enum(['up', 'down']), pixels: z.number().int().positive().optional() },
      (a) => act(async () => {
        const p = await b.getPage()
        const dy = (a.pixels ?? 600) * (a.direction === 'up' ? -1 : 1)
        await p.mouse.wheel(0, dy)
        await p.waitForTimeout(250)
        const pos = await p.evaluate('Math.round(scrollY) + " / " + Math.round(document.documentElement.scrollHeight - innerHeight)') as string
        return text(`Skrolano. Pozicija: ${pos}px.`)
      })),

    tool('browser_screenshot', 'Snimi sliku browser panela i vrati je kao sliku (koristi kad raspored ili vizualni sadržaj nije jasan iz snapshota).',
      {},
      () => act(async () => {
        let buf: Buffer
        try {
          const p = await b.getPage()
          buf = await p.screenshot({ type: 'jpeg', quality: 60 })
        } catch {
          buf = (await b.view.webContents.capturePage()).toJPEG(60)
        }
        return { content: [{ type: 'image' as const, data: buf.toString('base64'), mimeType: 'image/jpeg' }] }
      })),

    tool('browser_eval', 'Izvrši JavaScript izraz u stranici i vrati rezultat (JSON).',
      { script: z.string() },
      (a) => act(async () => {
        const p = await b.getPage()
        const r = await p.evaluate((src) => {
          // eslint-disable-next-line no-new-func
          const v = new Function(`return (${src})`)()
          return v
        }, a.script)
        let s: string
        try { s = typeof r === 'string' ? r : JSON.stringify(r, null, 2) ?? String(r) } catch { s = String(r) }
        return text(clip(s))
      })),

    tool('browser_back', 'Vrati se na prethodnu stranicu.', {},
      () => act(async () => { b.back(); await b.waitSettled(); return text(await snapshot()) })),

    tool('browser_tabs', 'Upravljaj tabovima browser panela: popis (list), novi tab (new, opcionalno s URL-om), prebaci (select) ili zatvori (close) tab po id-u. Ostali browser alati rade na aktivnom tabu.',
      { action: z.enum(['list', 'new', 'select', 'close']), id: z.string().optional(), url: z.string().optional() },
      (a) => act(async () => {
        if (a.action === 'new') { b.newTab(a.url); if (a.url) await b.waitSettled() }
        else if (a.action === 'select' && a.id) b.selectTab(a.id)
        else if (a.action === 'close' && a.id) b.closeTab(a.id)
        const list = b.tabList().map((t) => `${t.active ? '*' : ' '} [${t.id}] ${t.title || '(prazno)'} ${t.url}`)
        return text(`Tabovi (* = aktivni):\n${list.join('\n')}`)
      })),

    tool('browser_wait','Pričekaj zadani broj milisekundi ili dok se ne pojavi CSS selektor.',
      { ms: z.number().int().min(50).max(30000).optional(), selector: z.string().optional() },
      (a) => act(async () => {
        const p = await b.getPage()
        if (a.selector) await p.waitForSelector(a.selector, { timeout: a.ms ?? 10000 })
        else await p.waitForTimeout(a.ms ?? 1000)
        return text('Gotovo.')
      })),
  ]

  async function snapshot(): Promise<string> {
    const p = await b.getPage()
    const s = b.state()
    const refs = await p.evaluate(SNAPSHOT_SCRIPT).catch((e) => `(snapshot elemenata nije uspio: ${String(e)})`)
    const aria = await p.locator('body').ariaSnapshot().catch(() => '')
    return [
      `URL: ${s.url || '(prazno)'}`,
      `Naslov: ${s.title || '(bez naslova)'}`,
      '',
      '## Interaktivni elementi',
      String(refs) || '(nema)',
      '',
      '## Struktura stranice',
      clip(aria, 9000) || '(nema)',
    ].join('\n')
  }

  return createSdkMcpServer({ name: 'mymux', version: '0.1.0', tools: [...tools, ...extraTools] })
}
