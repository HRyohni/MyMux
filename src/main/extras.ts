import { dialog, type BrowserWindow } from 'electron'
import { getSessionMessages, getSubagentMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { marked } from 'marked'
import type { DirEntry, HistoryMessage, TranscriptHit } from '../shared/ipc'

/** One level of the working folder for the file tree: folders first, then files, by name. */
export async function listDir(cwd: string, rel: string): Promise<DirEntry[]> {
  const dir = resolve(cwd, rel)
  const back = relative(resolve(cwd), dir)
  if (back.startsWith('..') || isAbsolute(back)) throw new Error('Mapa je izvan radne mape')
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '.git' && (e.isDirectory() || e.isFile()))
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
}

function messageText(message: unknown): string {
  const content = (message as { content?: unknown })?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => {
    const blk = b as { type?: string; text?: string }
    return blk.type === 'text' ? blk.text ?? '' : ''
  }).join('\n')
}

/** Full-text search over the prompts and replies of the most recent stored sessions. */
export async function searchTranscripts(query: string, cwd?: string): Promise<TranscriptHit[]> {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const sessions = await listSessions({ dir: cwd, limit: 150 })
  const hits: TranscriptHit[] = []
  for (const s of sessions) {
    if (hits.length >= 40) break
    let msgs
    try { msgs = await getSessionMessages(s.sessionId, { dir: s.cwd ?? cwd }) } catch { continue }
    for (const m of msgs) {
      if (m.type === 'system') continue
      const text = messageText(m.message)
      const at = text.toLowerCase().indexOf(needle)
      if (at < 0) continue
      const start = Math.max(0, at - 60)
      hits.push({
        sessionId: s.sessionId, cwd: s.cwd, lastModified: s.lastModified,
        title: s.customTitle || s.summary || s.firstPrompt || s.sessionId,
        snippet: (start > 0 ? '…' : '') + text.slice(start, at + needle.length + 100).replace(/\s+/g, ' '),
      })
      break
    }
  }
  return hits
}

export async function getSubagentHistory(sdkSessionId: string, cwd: string | undefined, agentIds: string[]): Promise<Record<string, HistoryMessage[]>> {
  const out: Record<string, HistoryMessage[]> = {}
  await Promise.all(agentIds.slice(0, 40).map(async (agentId) => {
    try {
      const msgs = await getSubagentMessages(sdkSessionId, agentId, { dir: cwd, limit: 400 })
      out[agentId] = msgs.map((m) => ({ type: m.type, uuid: m.uuid, message: m.message, parent_tool_use_id: null }))
    } catch { /* the subagent's transcript is gone */ }
  }))
  return out
}

const EXPORT_STYLE = `body{font-family:"Segoe UI",system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 20px;line-height:1.6;color:#111827}
pre{background:#f3f4f6;padding:12px;border-radius:8px;overflow-x:auto}code{font-family:Consolas,monospace;font-size:.92em}
blockquote{border-left:3px solid #d1d5db;margin-left:0;padding-left:14px;color:#374151}
table{border-collapse:collapse}td,th{border:1px solid #d1d5db;padding:4px 10px}h2{margin-top:2em;font-size:1.05em;color:#6b7280}`

export async function saveExport(win: BrowserWindow, defaultName: string, markdown: string): Promise<string | null> {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'HTML', extensions: ['html'] }],
  })
  if (r.canceled || !r.filePath) return null
  const html = extname(r.filePath).toLowerCase() === '.html'
  const body = html
    ? `<!doctype html><html><head><meta charset="utf-8"><title>${defaultName.replace(/[<&]/g, '')}</title><style>${EXPORT_STYLE}</style></head><body>${await marked.parse(markdown)}</body></html>`
    : markdown
  writeFileSync(r.filePath, body, 'utf-8')
  return r.filePath
}

/** The settings files a session in `cwd` reads and the app may edit, whether or not they exist yet. */
export function settingsPaths(cwd: string): Record<'user' | 'project' | 'local', string> {
  return {
    user: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
    project: join(cwd, '.claude', 'settings.json'),
    local: join(cwd, '.claude', 'settings.local.json'),
  }
}

/**
 * Adds or removes one rule in a settings file's permissions list. Only the user, project and local
 * settings files of `cwd` can be edited, and everything else in the file is left as it was.
 */
export async function editPermissionRule(cwd: string, path: string, list: 'allow' | 'ask' | 'deny', rule: string, add: boolean): Promise<void> {
  const value = rule.trim()
  if (!value) throw new Error('Pravilo je prazno')
  const known = Object.values(settingsPaths(cwd)).map((p) => resolve(p))
  if (!known.includes(resolve(path))) throw new Error('Ova datoteka postavki se ne može uređivati iz aplikacije')
  let json: Record<string, unknown> = {}
  if (existsSync(path)) {
    try { json = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown> } catch { throw new Error('Datoteka postavki nije ispravan JSON; uredi je ručno') }
  }
  const perms = (json.permissions && typeof json.permissions === 'object' ? json.permissions : {}) as Record<string, unknown>
  const cur = Array.isArray(perms[list]) ? (perms[list] as string[]) : []
  const next = add ? (cur.includes(value) ? cur : [...cur, value]) : cur.filter((r) => r !== value)
  // An emptied list is removed rather than left behind as [].
  const { [list]: _old, ...others } = perms
  json.permissions = next.length ? { ...perms, [list]: next } : others
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf-8')
}
