import { useEffect, useState } from 'react'
import { ChevronRight, File as FileIcon, Folder } from 'lucide-react'
import type { DirEntry } from '../../../shared/ipc'

function Dir({ cwd, rel, depth, onOpen }: { cwd: string; rel: string; depth: number; onOpen(path: string): void }) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.aimux.listDir(cwd, rel).then((e) => { if (!cancelled) setEntries(e) }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [cwd, rel])

  const pad = { paddingLeft: 8 + depth * 12 }
  if (error) return <div style={pad} className="py-0.5 text-[11.5px] text-danger">ne može se pročitati</div>
  if (!entries) return <div style={pad} className="py-0.5 text-[11.5px] text-fg-faint">…</div>
  if (entries.length === 0) return <div style={pad} className="py-0.5 text-[11.5px] text-fg-faint">(prazno)</div>

  return (
    <>
      {entries.map((e) => {
        const path = rel ? `${rel}/${e.name}` : e.name
        return (
          <div key={e.name}>
            <button style={pad} title={path}
              onClick={() => (e.dir ? setOpen((o) => ({ ...o, [e.name]: !o[e.name] })) : onOpen(path))}
              className="w-full flex items-center gap-1 pr-2 py-[3px] text-left text-[12px] text-fg-muted hover:text-fg hover:bg-bg-elev2">
              {e.dir
                ? <><ChevronRight size={11} className={`shrink-0 transition ${open[e.name] ? 'rotate-90' : ''}`} /><Folder size={12} className="shrink-0" /></>
                : <><span className="w-[11px] shrink-0" /><FileIcon size={12} className="shrink-0 text-fg-faint" /></>}
              <span className="truncate">{e.name}</span>
            </button>
            {e.dir && open[e.name] && <Dir cwd={cwd} rel={path} depth={depth + 1} onOpen={onOpen} />}
          </div>
        )
      })}
    </>
  )
}

/** Lazy tree of the working folder; clicking a file opens it in the browser panel. */
export default function FileTree({ cwd, onOpen }: { cwd: string; onOpen(path: string): void }) {
  return (
    <div className="h-full overflow-auto py-1 select-none">
      <Dir cwd={cwd} rel="" depth={0} onOpen={onOpen} />
    </div>
  )
}
