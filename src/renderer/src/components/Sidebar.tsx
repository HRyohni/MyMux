import { Plus, MessageSquare, X, Folder, Columns2, Rows2 } from 'lucide-react'
import { useStore, leaves } from '../store'

function basename(p: string) {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

export default function Sidebar() {
  const order = useStore((s) => s.order)
  const sessions = useStore((s) => s.sessions)
  const layout = useStore((s) => s.layout)
  const focusedPane = useStore((s) => s.focusedPane)
  const showSession = useStore((s) => s.showSession)
  const setPaneSession = useStore((s) => s.setPaneSession)
  const splitPane = useStore((s) => s.splitPane)
  const removeSession = useStore((s) => s.removeSession)

  const visible = new Map(leaves(layout).filter((l) => l.sessionId).map((l) => [l.sessionId as string, l.id]))
  const focusedLeaf = leaves(layout).find((l) => l.id === focusedPane)
  const welcomeActive = !!focusedLeaf && !focusedLeaf.sessionId

  const close = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await window.aimux.closeSession(id)
    removeSession(id)
  }

  const iconBtn = 'w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2'

  return (
    <aside className="w-64 shrink-0 flex flex-col bg-bg-elev border-r border-border">
      <div className="drag h-10 flex items-center px-4 text-[13px] font-semibold tracking-wide text-fg-muted select-none">
        <span className="text-accent mr-1.5">●</span> aimux
      </div>

      <div className="px-3 pb-2 flex gap-1.5">
        <button
          onClick={() => setPaneSession(focusedPane, null)}
          title="Novi razgovor (Ctrl+N)"
          className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] border transition
            ${welcomeActive ? 'bg-bg-elev2 border-border-strong text-fg' : 'border-border text-fg-muted hover:text-fg hover:bg-bg-elev2'}`}
        >
          <Plus size={15} /> Novi razgovor
        </button>
        <button onClick={() => splitPane(focusedPane, 'horizontal')} title="Podijeli desno (Ctrl+\)" className={`${iconBtn} border border-border`}><Columns2 size={15} /></button>
        <button onClick={() => splitPane(focusedPane, 'vertical')} title="Podijeli dolje (Ctrl+Shift+\)" className={`${iconBtn} border border-border`}><Rows2 size={15} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {order.length === 0 && (
          <div className="px-3 py-6 text-xs text-fg-faint text-center">Nema aktivnih razgovora</div>
        )}
        {order.map((id) => {
          const s = sessions[id]
          if (!s) return null
          const paneId = visible.get(id)
          const active = paneId === focusedPane
          return (
            <div
              key={id}
              onClick={() => showSession(id)}
              className={`group relative flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition
                ${active ? 'bg-bg-elev2 text-fg' : paneId ? 'bg-bg-elev2/50 text-fg' : 'text-fg-muted hover:bg-bg-elev2/60 hover:text-fg'}`}
            >
              <div className="mt-0.5 shrink-0">
                {s.meta.running
                  ? <span className="block w-3.5 h-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  : <MessageSquare size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] leading-tight">{s.meta.title}</div>
                <div className="truncate text-[11px] text-fg-faint flex items-center gap-1 mt-0.5">
                  <Folder size={10} /> {basename(s.meta.cwd)}
                  {s.pending.length > 0 && <span className="ml-1 text-warn">● čeka odobrenje</span>}
                  {s.meta.ended && <span className="ml-1">· završeno</span>}
                </div>
              </div>
              <button
                onClick={(e) => close(e, id)}
                title="Zatvori razgovor"
                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-fg-faint hover:text-danger transition"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="px-4 py-2 text-[10.5px] text-fg-faint border-t border-border leading-relaxed">
        Ctrl+N novi · Ctrl+\ split · Ctrl+W zatvori panel · Ctrl+B browser
      </div>
    </aside>
  )
}
