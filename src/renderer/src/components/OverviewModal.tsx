import { useStore, groupOfSession } from '../store'
import { changedFileCount } from '../reducer'
import Modal from './Modal'

function basename(p: string) {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** Every open conversation at a glance: what it is doing and what it is waiting for. */
export default function OverviewModal({ onClose }: { onClose(): void }) {
  const sessions = useStore((s) => s.sessions)
  const order = useStore((s) => s.order)
  const groups = useStore((s) => s.groups)
  const showSession = useStore((s) => s.showSession)
  const rows = order.map((id) => sessions[id]).filter(Boolean)
  const totalCost = rows.reduce((a, s) => a + (s.meta.costUsd ?? 0), 0)
  // Sessions that need the user come first, then the ones working, then the rest.
  const rank = (s: typeof rows[number]) => (s.pending.length || s.elicitations.length ? 0 : s.meta.running ? 1 : s.meta.ended ? 3 : 2)
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b))

  return (
    <Modal title={`Pregled razgovora (${rows.length})`} onClose={onClose} width="max-w-4xl">
      {rows.length === 0
        ? <div className="p-8 text-center text-[13px] text-fg-faint">Nema otvorenih razgovora.</div>
        : (
          <div className="p-2">
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_5rem_4.5rem_4rem] gap-x-3 px-3 py-1 text-[10.5px] uppercase tracking-wider text-fg-faint">
              <span>Razgovor</span><span>Stanje</span><span className="text-right">Kontekst</span><span className="text-right">Trošak</span><span className="text-right">Izmjene</span>
            </div>
            {sorted.map((s) => {
              const waiting = s.pending.length + s.elicitations.length
              const state = waiting ? { text: s.pending[0]?.toolName === 'AskUserQuestion' ? 'ima pitanje' : s.pending[0]?.toolName === 'ExitPlanMode' ? 'plan čeka pregled' : 'čeka odobrenje', tone: 'text-warn' }
                : s.meta.compacting ? { text: 'sažima kontekst', tone: 'text-accent' }
                : s.meta.running ? { text: 'radi', tone: 'text-accent' }
                : s.meta.ended ? { text: 'završeno', tone: 'text-fg-faint' }
                : { text: 'slobodan', tone: 'text-ok' }
              const extra = [
                s.meta.queued?.length ? `${s.meta.queued.length} u redu` : '',
                s.meta.tasks?.length ? `${s.meta.tasks.length} u pozadini` : '',
              ].filter(Boolean).join(' · ')
              return (
                <button key={s.meta.id} onClick={() => { showSession(s.meta.id); onClose() }}
                  className="w-full grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_5rem_4.5rem_4rem] gap-x-3 items-center px-3 py-2 rounded-lg text-left text-[13px] hover:bg-bg-elev2">
                  <span className="min-w-0">
                    <span className="block truncate">{s.meta.title}</span>
                    <span className="block truncate text-[11px] text-fg-faint" title={s.meta.cwd}>
                      {basename(s.meta.cwd)}{groupOfSession(groups, s.meta.id) ? ` · ${groupOfSession(groups, s.meta.id)!.name}` : ' · nije u panelu'}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate ${state.tone}`}>{state.text}</span>
                    {extra && <span className="block truncate text-[11px] text-fg-faint">{extra}</span>}
                  </span>
                  <span className="text-right tabular-nums text-fg-muted">{s.meta.context ? `${s.meta.context.percentage}%` : '–'}</span>
                  <span className="text-right tabular-nums text-fg-muted">{s.meta.costUsd ? `$${s.meta.costUsd.toFixed(2)}` : '–'}</span>
                  <span className="text-right tabular-nums text-fg-muted">{changedFileCount(s.items) || '–'}</span>
                </button>
              )
            })}
            <div className="px-3 pt-2 mt-1 border-t border-border text-[11.5px] text-fg-faint text-right">Ukupni trošak otvorenih razgovora: ${totalCost.toFixed(2)}</div>
          </div>
        )}
    </Modal>
  )
}
