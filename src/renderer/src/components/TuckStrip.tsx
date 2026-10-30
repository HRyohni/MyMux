import { useStore, selectActiveGroup } from '../store'

/** Conversations pulled to the window's edge. They keep running; a click puts one back in its split. */
export default function TuckStrip() {
  const tucked = useStore((s) => selectActiveGroup(s).tucked) ?? []
  const sessions = useStore((s) => s.sessions)
  const untuck = useStore((s) => s.untuckSession)
  const shown = tucked.filter((t) => sessions[t.sessionId])
  if (shown.length === 0) return null
  return (
    <aside className="w-8 shrink-0 pt-11 pb-2 flex flex-col items-center gap-1.5 overflow-y-auto border-l border-border bg-bg-elev [scrollbar-width:none]">
      {shown.map((t) => {
        const { meta, pending, elicitations } = sessions[t.sessionId]
        const waiting = pending.length > 0 || elicitations.length > 0
        const dot = waiting ? 'bg-warn pulse' : meta.running ? 'bg-accent pulse' : meta.ended ? 'bg-fg-faint' : 'bg-ok'
        const status = waiting ? 'čeka tebe' : meta.running ? 'radi' : meta.ended ? 'završio' : 'slobodan'
        return (
          <button key={t.sessionId} onClick={() => untuck(t.sessionId)} title={`${meta.title} · ${status}\nKlik vraća razgovor (Ctrl+Shift+J za zadnji)`}
            className="tuck-in w-6 shrink-0 py-2 flex flex-col items-center gap-2 rounded-md text-[11.5px] text-fg-muted hover:text-fg hover:bg-bg-elev2">
            <span className={`w-2 h-2 shrink-0 rounded-full ${dot}`} />
            <span className="[writing-mode:vertical-rl] max-h-36 truncate">{meta.title}</span>
          </button>
        )
      })}
    </aside>
  )
}
