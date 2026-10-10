import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import mammoth from 'mammoth'
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
`

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

function wrap(title: string, body: string, wide = false, src = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${src ? `<div class="src">${esc(src)}</div>` : ''}<div class="page${wide ? ' wide' : ''}">${body}</div></body></html>`
}

async function render(abs: string): Promise<{ html: string; wide: boolean } | null> {
  const ext = extname(abs).toLowerCase()
  const name = basename(abs)
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
  const dir = join(app.getPath('temp'), 'aimux-docs')
  mkdirSync(dir, { recursive: true })
  const key = createHash('sha1').update(abs + statSync(abs).mtimeMs).digest('hex').slice(0, 16)
  const out = join(dir, `${key}.html`)
  writeFileSync(out, rendered.html, 'utf-8')
  return pathToFileURL(out).href
}

export const VIEWABLE_EXTENSIONS = [
  'pdf', 'docx', 'xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'md', 'markdown', 'txt', 'log', 'json',
  'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ts', 'js', 'py', 'xml', 'yaml', 'yml',
]
