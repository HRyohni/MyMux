import { app } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { rankFiles } from '../shared/fuzzy'
import type { TextFile } from '../shared/ipc'

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
const MAX_EDITABLE = 2 * 1024 * 1024

export function readTextFile(cwd: string, path: string): TextFile {
  const abs = resolve(cwd, path)
  const { size, mtimeMs } = statSync(abs)
  if (size > MAX_EDITABLE) throw new Error('Datoteka je prevelika za editor')
  const data = readFileSync(abs)
  if (data.subarray(0, 8000).includes(0)) throw new Error('Datoteka nije tekstualna')
  return { path: abs, content: data.toString('utf-8'), mtime: mtimeMs }
}

export function writeTextFile(path: string, content: string, expectedMtime: number | null): number {
  if (expectedMtime !== null && fileMtime(path) !== expectedMtime) throw new Error('CONFLICT')
  writeFileSync(path, content, 'utf-8')
  return statSync(path).mtimeMs
}

export function fileMtime(path: string): number | null {
  try { return statSync(path).mtimeMs } catch { return null }
}

export function saveTempFile(name: string, base64: string): string {
  const dir = join(app.getPath('temp'), 'mymux-attachments', randomUUID().slice(0, 8))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, basename(name) || 'prilog')
  writeFileSync(file, Buffer.from(base64, 'base64'))
  return file
}
