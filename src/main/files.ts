import { app } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { rankFiles } from '../shared/fuzzy'

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', 'target', '.next', '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vs',
])
const MAX_FILES = 40000
const CACHE_MS = 20000

const cache = new Map<string, { at: number; files: Promise<string[]> }>()

/** Tracked and untracked-but-not-ignored files, so .gitignore is respected. */
function gitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((res) => {
    execFile('git', ['ls-files', '-co', '--exclude-standard'], { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out) => {
      res(err ? null : out.split('\n').filter(Boolean).slice(0, MAX_FILES))
    })
  })
}

async function walk(cwd: string): Promise<string[]> {
  const out: string[] = []
  const queue = ['']
  while (queue.length && out.length < MAX_FILES) {
    const rel = queue.shift() as string
    let entries
    try { entries = await readdir(join(cwd, rel), { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) queue.push(p) }
      else if (e.isFile()) out.push(p)
    }
  }
  return out
}

async function listFiles(cwd: string): Promise<string[]> {
  const hit = cache.get(cwd)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files
  const files = (existsSync(join(cwd, '.git')) ? gitFiles(cwd) : Promise.resolve(null)).then((g) => g ?? walk(cwd))
  cache.set(cwd, { at: Date.now(), files })
  return files
}

/** Files under `cwd` matching the query, best first, as forward-slash relative paths. */
export async function searchFiles(cwd: string, query: string): Promise<string[]> {
  return rankFiles(await listFiles(cwd), query, 30)
}

/** Stores an attachment that has no path of its own (pasted or dragged out of another app). */
export function saveTempFile(name: string, base64: string): string {
  const dir = join(app.getPath('temp'), 'mymux-attachments', randomUUID().slice(0, 8))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, basename(name) || 'prilog')
  writeFileSync(file, Buffer.from(base64, 'base64'))
  return file
}
