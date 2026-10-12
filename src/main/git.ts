import { execFile } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import type { GitStatus, GitFile } from '../shared/ipc'

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) rej(new Error((stderr || err.message).trim()))
      else res(stdout)
    })
  })
}

/** Branch and changed files of the repository containing `cwd`, or null when it is not a repository. */
export async function gitStatus(cwd: string): Promise<GitStatus | null> {
  let out: string
  try { out = await git(cwd, ['status', '--porcelain=v2', '--branch', '--untracked-files=all']) } catch { return null }
  const status: GitStatus = { branch: '', ahead: 0, behind: 0, files: [] }
  const byPath = new Map<string, GitFile>()
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) status.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) status.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) { status.ahead = Number(m[1]); status.behind = Number(m[2]) }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // "1 XY sub mH mI mW hH hI path", renames ("2 ...") carry "path<TAB>origPath".
      const parts = line.split(' ')
      const path = parts.slice(line.startsWith('2 ') ? 9 : 8).join(' ').split('\t')[0]
      byPath.set(path, { path, status: parts[1].replace(/\./g, '') || 'M', added: 0, removed: 0 })
    } else if (line.startsWith('? ')) {
      const path = line.slice(2)
      byPath.set(path, { path, status: '?', added: 0, removed: 0 })
    } else if (line.startsWith('u ')) {
      const path = line.split(' ').slice(10).join(' ')
      byPath.set(path, { path, status: 'U', added: 0, removed: 0 })
    }
  }
  // Line counts against HEAD cover staged and unstaged changes together.
  const numstat = await git(cwd, ['diff', 'HEAD', '--numstat']).catch(() => '')
  for (const line of numstat.split('\n')) {
    const [a, r, ...rest] = line.split('\t')
    const f = byPath.get(rest.join('\t'))
    if (f) { f.added = Number(a) || 0; f.removed = Number(r) || 0 }
  }
  status.files = [...byPath.values()]
  return status
}

/** Unified diff of one path against HEAD; untracked files are shown as all-new. */
export async function gitDiff(cwd: string, path: string): Promise<string> {
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', path]).then(() => true, () => false)
  if (tracked) return git(cwd, ['diff', 'HEAD', '--', path])
  // --no-index exits with 1 when the files differ, which is the expected case here.
  return new Promise((res) => {
    execFile('git', ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', path],
      { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (_err, stdout) => res(stdout))
  })
}

/** Stages everything and commits it. */
export async function gitCommit(cwd: string, message: string): Promise<string> {
  if (!message.trim()) throw new Error('Poruka commita je prazna')
  await git(cwd, ['add', '-A'])
  return (await git(cwd, ['commit', '-m', message])).trim().split('\n')[0]
}

export async function gitStash(cwd: string): Promise<string> {
  return (await git(cwd, ['stash', 'push', '--include-untracked'])).trim()
}

/** Adds a worktree on a new branch in a sibling folder, so a second conversation can work without touching this checkout. */
export async function gitWorktree(cwd: string, branch: string): Promise<string> {
  const name = branch.trim()
  if (!/^[\w./-]+$/.test(name)) throw new Error('Ime grane smije sadržavati slova, brojke, točku, crticu i kosu crtu')
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  const target = join(dirname(root), `${basename(root)}-${name.replace(/[/.]/g, '-')}`)
  await git(root, ['worktree', 'add', '-b', name, target])
  return target
}
