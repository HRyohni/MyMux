import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import * as XLSXns from 'xlsx'

// xlsx ships CommonJS; under ESM the API lives on `default`.
const XLSX = ((XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns) as typeof XLSXns
import { marked } from 'marked'

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #f3f4f6; font-family: "Segoe UI", system-ui, sans-serif; color: #111827; }
  .page { max-width: 900px; margin: 24px auto; background: #fff; padding: 40px 48px; box-shadow: 0 1px 4px rgba(0,0,0,.12); border-radius: 6px; line-height: 1.55; }
  .page.wide { max-width: none; margin: 16px; padding: 20px; }
  h1, h2, h3 { line-height: 1.25; }
  table { border-collapse: collapse; font-size: 13px; }
  td, th { border: 1px solid #d1d5db; padding: 4px 8px; white-space: nowrap; }
  th { background: #f9fafb; }
  tr:first-child td { font-weight: 600; background: #f9fafb; }
  .sheet { margin-bottom: 32px; overflow-x: auto; }
  .sheet h2 { font-size: 15px; margin: 0 0 8px; color: #374151; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; }
  code { font-family: Consolas, monospace; font-size: 0.92em; }
  img { max-width: 100%; }
  .src { font-size: 11px; color: #6b7280; margin: 0 auto 8px; max-width: 900px; }
  .slide { max-width: 960px; margin: 20px auto; background: #fff; padding: 36px 48px; box-shadow: 0 1px 4px rgba(0,0,0,.14); border-radius: 6px; line-height: 1.5; position: relative; min-height: 300px; }
  .slide .no { position: absolute; right: 14px; bottom: 10px; font-size: 11px; color: #9ca3af; }
  .slide h2 { font-size: 26px; margin: 0 0 16px; }
  .slide p { margin: 6px 0; font-size: 17px; }
  .slide table { margin: 12px 0; font-size: 14px; }
  .slide td { white-space: normal; }
  .slide .notes { margin-top: 24px; padding-top: 10px; border-top: 1px dashed #d1d5db; font-size: 13px; color: #6b7280; white-space: pre-wrap; }
`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

function wrap(title: string, body: string, wide = false, src = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${src ? `<div class="src">${esc(src)}</div>` : ''}<div class="page${wide ? ' wide' : ''}">${body}</div></body></html>`
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
}

const xmlText = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')

/** Relationship id -> target path, resolved against the part that owns the .rels file. */
async function readRels(zip: JSZip, part: string): Promise<Map<string, { target: string; type: string }>> {
  const dir = part.slice(0, part.lastIndexOf('/'))
  const xml = await zip.file(`${dir}/_rels/${part.slice(dir.length + 1)}.rels`)?.async('string')
  const out = new Map<string, { target: string; type: string }>()
  for (const m of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[0])?.[1] ?? ''
    const raw = attr('Target')
    const segs = (raw.startsWith('/') ? raw.slice(1) : `${dir}/${raw}`).split('/')
    const path: string[] = []
    for (const seg of segs) { if (seg === '..') path.pop(); else if (seg !== '.') path.push(seg) }
    out.set(attr('Id'), { target: path.join('/'), type: attr('Type') })
  }
  return out
}

/** Paragraphs of a shape or table cell as HTML, indented by their outline level. */
function paragraphs(xml: string): string[] {
  const out: string[] = []
  for (const p of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const text = [...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)]
      .map((r) => (r[1] === undefined ? '\n' : xmlText(r[1]))).join('')
    if (!text.trim()) continue
    const lvl = Number(/<a:pPr\b[^>]*\blvl="(\d+)"/.exec(p[1])?.[1] ?? 0)
    out.push(`<p style="margin-left:${lvl * 24}px">${esc(text).replace(/\n/g, '<br>')}</p>`)
  }
  return out
}

/**
 * Simplified PPTX view: per slide the title, text, tables, pictures and speaker notes in reading order.
 * Exact positions, themes and animations are not reproduced.
 */
async function renderPptx(abs: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(abs))
  const presRels = await readRels(zip, 'ppt/presentation.xml')
  const pres = (await zip.file('ppt/presentation.xml')?.async('string')) ?? ''
  let slides = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => presRels.get(m[1])?.target).filter((t): t is string => !!t && !!zip.file(t))
  if (slides.length === 0) {
    const num = (f: string) => Number(/slide(\d+)\.xml$/.exec(f)?.[1] ?? 0)
    slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => num(a) - num(b))
  }
  const parts: string[] = []
  for (const [i, path] of slides.entries()) {
    const xml = await (zip.file(path) as JSZip.JSZipObject).async('string')
    const rels = await readRels(zip, path)
    let title = ''
    const body: string[] = []
    for (const el of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:pic\b[\s\S]*?<\/p:pic>|<a:tbl\b[\s\S]*?<\/a:tbl>/g)) {
      const s = el[0]
      if (s.startsWith('<p:pic')) {
        const target = rels.get(/<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(s)?.[1] ?? '')?.target
        const mime = IMAGE_MIME[target?.split('.').pop()?.toLowerCase() ?? '']
        const file = target ? zip.file(target) : null
        if (file && mime) body.push(`<p><img src="data:${mime};base64,${await file.async('base64')}"></p>`)
      } else if (s.startsWith('<a:tbl')) {
        const rows = [...s.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((r) =>
          `<tr>${[...r[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((c) => `<td>${paragraphs(c[0]).join('')}</td>`).join('')}</tr>`)
        body.push(`<table>${rows.join('')}</table>`)
      } else {
        const ps = paragraphs(s)
        if (!title && /<p:ph\b[^>]*\btype="(title|ctrTitle)"/.test(s)) title = ps.join(' ').replace(/<[^>]+>/g, ' ').trim()
        else body.push(...ps)
      }
    }
    const notesPath = [...rels.values()].find((r) => r.type.endsWith('/notesSlide'))?.target
    const notesXml = notesPath ? await zip.file(notesPath)?.async('string') : undefined
    const notesShape = notesXml ? [...notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].find((m) => /<p:ph\b[^>]*\btype="body"/.test(m[0])) : undefined
    const notes = notesShape ? paragraphs(notesShape[0]).join('') : ''
    parts.push(`<section class="slide">${title ? `<h2>${title}</h2>` : ''}${body.join('')}`
      + `${notes ? `<div class="notes">${notes}</div>` : ''}<span class="no">${i + 1} / ${slides.length}</span></section>`)
  }
  const name = basename(abs)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>${STYLE}</style></head>
<body><div class="src">${esc(abs)} · pojednostavljeni prikaz (tekst, tablice, slike, bilješke)</div>${parts.join('') || '<div class="page">Prezentacija nema slajdova.</div>'}</body></html>`
}

async function render(abs: string): Promise<{ html: string; wide: boolean } | null> {
  const ext = extname(abs).toLowerCase()
  const name = basename(abs)
  if (ext === '.pptx' || ext === '.ppsx') return { html: await renderPptx(abs), wide: true }
  if (ext === '.docx') {
    const r = await mammoth.convertToHtml({ path: abs })
    return { html: wrap(name, r.value, false, abs), wide: false }
  }
  if (['.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv'].includes(ext)) {
    const wb = XLSX.readFile(abs, { cellDates: true })
    const parts = wb.SheetNames.map((sn) => {
      const ws = wb.Sheets[sn]
      const table = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' })
      return `<div class="sheet"><h2>${esc(sn)}</h2>${table}</div>`
    })
    return { html: wrap(name, parts.join(''), true, abs), wide: true }
  }
  if (['.md', '.markdown'].includes(ext)) {
    const md = readFileSync(abs, 'utf-8')
    return { html: wrap(name, await marked.parse(md), false, abs), wide: false }
  }
  if (['.txt', '.log', '.json', '.yaml', '.yml', '.ts', '.js', '.py', '.cs', '.java', '.xml', '.ini', '.toml'].includes(ext)) {
    const txt = readFileSync(abs, 'utf-8')
    return { html: wrap(name, `<pre><code>${esc(txt)}</code></pre>`, false, abs), wide: false }
  }
  return null
}

/**
 * Returns a URL the embedded browser can display for the given file.
 * PDFs, images and HTML load directly; Office and text formats are converted to a temp HTML page.
 */
export async function toViewableUrl(abs: string): Promise<string> {
  const rendered = await render(abs)
  if (!rendered) return pathToFileURL(abs).href
  const dir = join(app.getPath('temp'), 'mymux-docs')
  mkdirSync(dir, { recursive: true })
  const key = createHash('sha1').update(abs + statSync(abs).mtimeMs).digest('hex').slice(0, 16)
  const out = join(dir, `${key}.html`)
  writeFileSync(out, rendered.html, 'utf-8')
  return pathToFileURL(out).href
}

export const VIEWABLE_EXTENSIONS = [
  'pdf', 'docx', 'pptx', 'ppsx', 'xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'md', 'markdown', 'txt', 'log', 'json',
  'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ts', 'js', 'py', 'xml', 'yaml', 'yml',
]
