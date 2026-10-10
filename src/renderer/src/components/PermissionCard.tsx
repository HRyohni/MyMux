import { ShieldAlert } from 'lucide-react'
import { useStore } from '../store'
import type { PermissionRequest } from '../../../shared/ipc'

function describe(req: PermissionRequest): string {
  const i = req.input
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined)
  switch (req.toolName) {
    case 'Bash': case 'PowerShell': return s('command') ?? ''
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return s('file_path') ?? ''
    case 'WebFetch': return s('url') ?? ''
    default: return JSON.stringify(i, null, 2)
  }
}

export default function PermissionCard({ req }: { req: PermissionRequest }) {
  const resolve = useStore((s) => s.resolvePermission)
  const answer = async (a: Parameters<typeof window.aimux.answerPermission>[1]) => {
    resolve(req.sessionId, req.requestId)
    await window.aimux.answerPermission(req.requestId, a)
  }
  const canRemember = !!req.suggestions?.length

  return (
    <div className="ml-10 rounded-xl border border-warn/40 bg-warn/5 p-3.5 fade-in">
      <div className="flex items-center gap-2 text-warn text-[13px] font-medium">
        <ShieldAlert size={16} /> Claude želi pokrenuti <span className="font-mono">{req.toolName}</span>
      </div>
      <pre className="mt-2.5 font-mono text-[12.5px] whitespace-pre-wrap break-all bg-bg rounded-lg p-2.5 border border-border max-h-56 overflow-auto">
        {describe(req)}
      </pre>
      {req.blockedPath && (
        <div className="mt-2 text-[12px] text-fg-muted">Putanja izvan radne mape: <span className="font-mono">{req.blockedPath}</span></div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => answer({ behavior: 'allow' })}
          className="px-3 py-1.5 rounded-lg bg-accent text-black text-[13px] font-medium hover:brightness-110">
          Dopusti
        </button>
        {canRemember && (
          <button onClick={() => answer({ behavior: 'allow', updatedPermissions: req.suggestions })}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg-elev text-[13px] hover:bg-bg-elev2">
            Dopusti i zapamti
          </button>
        )}
        <button onClick={() => answer({ behavior: 'deny', message: 'Korisnik je odbio ovaj alat' })}
          className="px-3 py-1.5 rounded-lg border border-border bg-bg-elev text-[13px] text-fg-muted hover:text-danger hover:border-danger/50">
          Odbij
        </button>
      </div>
    </div>
  )
}
