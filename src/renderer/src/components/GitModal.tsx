import { useCallback, useEffect, useState } from 'react'
import { GitBranch, RefreshCw, Loader2, ArrowUp, ArrowDown } from 'lucide-react'
import { useStore } from '../store'
import { openSession, errText } from '../actions'
import type { GitStatus, PermissionMode } from '../../../shared/ipc'
import Modal from './Modal'

const STATUS_LABEL: Record<string, string> = { '?': 'novo', A: 'dodano', M: 'izmijenjeno', D: 'obrisano', R: 'preimenovano', U: 'konflikt' }

/** A unified diff with added and removed lines tinted. */
function UnifiedDiff({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return (
    <pre className="font-mono text-[12px] leading-[1.5] rounded-lg border border-border bg-bg overflow-auto max-h-[22rem]">
      {lines.map((l, i) => {
        const tone = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'text-fg-faint'
          : l.startsWith('@@') ? 'text-link bg-bg-elev'
          : l.startsWith('+') ? 'bg-ok/10'
          : l.startsWith('-') ? 'bg-danger/10' : ''
        return <div key={i} className={`px-2.5 whitespace-pre ${tone}`}>{l || ' '}</div>
      })}
    </pre>
  )
}

const button = 'px-3 py-1.5 rounded-lg border border-border bg-bg text-[12.5px] hover:bg-bg-elev2 disabled:opacity-40'
const input = 'flex-1 min-w-0 bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong placeholder:text-fg-faint'

/** Working tree of the session's folder: what really changed on disk, with commit, stash and worktree. */
export default function GitModal({ cwd, paneId, mode, onClose }: { cwd: string; paneId: string; mode: PermissionMode; onClose(): void }) {
  const [status, setStatus] = useState<GitStatus | null | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [branch, setBranch] = useState('')
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    window.aimux.gitStatus(cwd).then(setStatus).catch((e) => { setStatus(null); setNote({ text: errText(e), error: true }) })
  }, [cwd])
  useEffect(load, [load])

  useEffect(() => {
    if (!selected) { setDiff(''); return }
    let cancelled = false
    window.aimux.gitDiff(cwd, selected).then((d) => { if (!cancelled) setDiff(d) }).catch((e) => { if (!cancelled) setDiff(errText(e)) })
    return () => { cancelled = true }
  }, [cwd, selected, status])

  const run = (fn: () => Promise<string>, done?: () => void) => {
    setBusy(true)
    setNote(null)
    fn().then((text) => { setNote({ text, error: false }); done?.(); load() })
      .catch((e) => setNote({ text: errText(e), error: true }))
      .finally(() => setBusy(false))
  }

  const worktree = () => run(async () => {
    const path = await window.aimux.gitWorktree(cwd, branch)
    const pane = useStore.getState().splitPane(paneId, 'horizontal')
    await openSession(pane, { cwd: path, permissionMode: mode })
    onClose()
    return `Worktree je na ${path}`
  })

  if (status === undefined) {
    return <Modal title="Git" onClose={onClose}><div className="p-8 text-center text-[13px] text-fg-faint"><Loader2 size={14} className="inline animate-spin mr-2" />Učitavam…</div></Modal>
  }
  if (status === null) {
    return <Modal title="Git" onClose={onClose}><div className="p-8 text-center text-[13px] text-fg-faint">Radna mapa nije git repozitorij.{note && <div className="mt-2 text-danger">{note.text}</div>}</div></Modal>
  }

  const total = status.files.reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 })

  return (
    <Modal title="Git" onClose={onClose} width="max-w-4xl">
      <div className="p-4 space-y-3 text-[13px]">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-fg-muted" />
          <span className="font-mono">{status.branch}</span>
          {status.upstream && <span className="text-fg-faint text-[12px]">→ {status.upstream}</span>}
          {status.ahead > 0 && <span className="flex items-center text-[12px] text-fg-muted" title="Commitova ispred udaljene grane"><ArrowUp size={12} />{status.ahead}</span>}
          {status.behind > 0 && <span className="flex items-center text-[12px] text-fg-muted" title="Commitova iza udaljene grane"><ArrowDown size={12} />{status.behind}</span>}
          <span className="flex-1" />
          <span className="font-mono text-[12px]"><span className="text-ok">+{total.added}</span> <span className="text-danger">−{total.removed}</span></span>
          <button onClick={load} className={button} title="Osvježi"><RefreshCw size={12} /></button>
        </div>

        {status.files.length === 0
          ? <div className="py-6 text-center text-fg-faint">Nema izmjena u radnom stablu.</div>
          : (
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
              <div className="border border-border rounded-lg overflow-auto max-h-[22rem] bg-bg">
                {status.files.map((f) => (
                  <button key={f.path} onClick={() => setSelected(f.path)} title={f.path}
                    className={`w-full flex items-center gap-2 px-2.5 py-1 text-left ${selected === f.path ? 'bg-bg-elev2' : 'hover:bg-bg-elev'}`}>
                    <span className="font-mono text-[12px] truncate flex-1">{f.path}</span>
                    <span className="text-[10.5px] text-fg-faint shrink-0">{STATUS_LABEL[f.status[0]] ?? f.status}</span>
                    <span className="font-mono text-[11px] shrink-0"><span className="text-ok">+{f.added}</span> <span className="text-danger">−{f.removed}</span></span>
                  </button>
                ))}
              </div>
              {selected
                ? <UnifiedDiff text={diff || '(nema razlike)'} />
                : <div className="rounded-lg border border-border flex items-center justify-center text-fg-faint text-[12.5px]">Odaberi datoteku za prikaz razlike</div>}
            </div>
          )}

        <div className="flex gap-2">
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Poruka commita (uključuje sve izmjene)" className={input}
            onKeyDown={(e) => { if (e.key === 'Enter' && message.trim() && !busy) run(() => window.aimux.gitCommit(cwd, message), () => { setMessage(''); setSelected(null) }) }} />
          <button disabled={busy || !message.trim() || status.files.length === 0} className={button}
            onClick={() => run(() => window.aimux.gitCommit(cwd, message), () => { setMessage(''); setSelected(null) })}>Commit</button>
          <button disabled={busy || status.files.length === 0} className={button} title="Spremi sve izmjene u stash (git stash --include-untracked)"
            onClick={() => run(() => window.aimux.gitStash(cwd), () => setSelected(null))}>Stash</button>
        </div>
        <div className="flex gap-2">
          <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Nova grana za worktree, npr. feature/api" className={input}
            onKeyDown={(e) => { if (e.key === 'Enter' && branch.trim() && !busy) worktree() }} />
          <button disabled={busy || !branch.trim()} onClick={worktree} className={button}
            title="Napravi worktree na novoj grani u susjednoj mapi i otvori razgovor u njemu, da dva razgovora ne mijenjaju iste datoteke">
            Novi worktree + razgovor
          </button>
        </div>
        {note && <div className={`text-[12px] whitespace-pre-wrap ${note.error ? 'text-danger' : 'text-fg-muted'}`}>{note.text}</div>}
      </div>
    </Modal>
  )
}
