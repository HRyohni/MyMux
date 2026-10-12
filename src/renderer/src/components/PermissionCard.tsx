import { useState } from 'react'
import { ShieldAlert, MessageCircleQuestion, ClipboardList, Check } from 'lucide-react'
import { useStore } from '../store'
import type { PermissionRequest, PermissionAnswer } from '../../../shared/ipc'
import Markdown from './Markdown'
import { editsOf } from '../reducer'
import DiffView from './DiffView'

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

function useAnswer(req: PermissionRequest) {
  const resolve = useStore((s) => s.resolvePermission)
  return async (a: PermissionAnswer) => {
    resolve(req.sessionId, req.requestId)
    await window.aimux.answerPermission(req.requestId, a)
  }
}

const primary = 'px-3 py-1.5 rounded-lg bg-accent text-black text-[13px] font-medium hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100'
const secondary = 'px-3 py-1.5 rounded-lg border border-border bg-bg-elev text-[13px] hover:bg-bg-elev2'
const field = 'w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong placeholder:text-fg-faint'

interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string; preview?: string }[]
}

/** AskUserQuestion: Claude offers choices; the picked labels go back as the tool's `answers`. */
function QuestionCard({ req }: { req: PermissionRequest }) {
  const answer = useAnswer(req)
  const questions = (Array.isArray(req.input.questions) ? req.input.questions : []) as Question[]
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})

  const toggle = (qi: number, label: string, multi: boolean) => setPicked((cur) => {
    const have = cur[qi] ?? []
    if (!multi) return { ...cur, [qi]: have.includes(label) ? [] : [label] }
    return { ...cur, [qi]: have.includes(label) ? have.filter((x) => x !== label) : [...have, label] }
  })

  const valueOf = (qi: number) => {
    const typed = other[qi]?.trim()
    const labels = questions[qi].multiSelect ? (picked[qi] ?? []) : typed ? [] : (picked[qi] ?? [])
    return [...labels, ...(typed ? [typed] : [])].join(', ')
  }
  const complete = questions.length > 0 && questions.every((_q, qi) => valueOf(qi))

  const submit = () => {
    const answers: Record<string, string> = {}
    questions.forEach((q, qi) => { answers[q.question] = valueOf(qi) })
    void answer({ behavior: 'allow', updatedInput: { ...req.input, answers } })
  }

  return (
    <div className="ml-10 rounded-xl border border-accent/40 bg-accent-soft/20 p-3.5 fade-in space-y-4">
      <div className="flex items-center gap-2 text-accent text-[13px] font-medium">
        <MessageCircleQuestion size={16} /> Claude ima pitanje
      </div>
      {questions.map((q, qi) => {
        const multi = !!q.multiSelect
        const preview = q.options.find((o) => o.preview && (picked[qi] ?? []).includes(o.label))?.preview
        return (
          <div key={qi}>
            <div className="text-[13.5px] font-medium">
              {q.header && <span className="mr-2 px-1.5 py-0.5 rounded bg-bg-elev2 text-[11px] text-fg-muted align-middle">{q.header}</span>}
              {q.question}
            </div>
            {multi && <div className="text-[11.5px] text-fg-faint mt-0.5">Možeš odabrati više odgovora.</div>}
            <div className="mt-2 grid gap-1.5">
              {q.options.map((o) => {
                const on = (picked[qi] ?? []).includes(o.label) && (multi || !other[qi]?.trim())
                return (
                  <button key={o.label} onClick={() => { toggle(qi, o.label, multi); if (!multi) setOther((c) => ({ ...c, [qi]: '' })) }}
                    className={`text-left px-3 py-2 rounded-lg border transition flex items-start gap-2.5
                      ${on ? 'border-accent bg-accent-soft/60' : 'border-border bg-bg-elev hover:bg-bg-elev2'}`}>
                    <span className={`mt-0.5 shrink-0 w-4 h-4 flex items-center justify-center border ${multi ? 'rounded' : 'rounded-full'}
                      ${on ? 'border-accent bg-accent text-black' : 'border-border-strong'}`}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{o.label}</span>
                      {o.description && <span className="block text-[12px] text-fg-muted mt-0.5">{o.description}</span>}
                    </span>
                  </button>
                )
              })}
              <input
                value={other[qi] ?? ''}
                onChange={(e) => setOther((c) => ({ ...c, [qi]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter' && complete) submit() }}
                placeholder="Drugo: upiši vlastiti odgovor"
                className={field}
              />
            </div>
            {preview && <pre className="mt-2 font-mono text-[12px] whitespace-pre-wrap bg-bg rounded-lg p-2.5 border border-border max-h-64 overflow-auto">{preview}</pre>}
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2">
        <button onClick={submit} disabled={!complete} className={primary}>Odgovori</button>
        <button onClick={() => answer({ behavior: 'deny', message: 'Korisnik nije odgovorio na pitanje; nastavi bez odgovora ili pitaj drugačije.' })}
          className={`${secondary} text-fg-muted`}>Preskoči</button>
      </div>
    </div>
  )
}

/** ExitPlanMode: the plan is shown in full; approving it also picks how edits are handled from here on. */
function PlanCard({ req }: { req: PermissionRequest }) {
  const answer = useAnswer(req)
  const [feedback, setFeedback] = useState('')
  const plan = typeof req.input.plan === 'string' ? req.input.plan : ''

  const approve = (mode: 'acceptEdits' | 'default') =>
    answer({ behavior: 'allow', updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }] })
  const keepPlanning = () => answer({
    behavior: 'deny',
    message: feedback.trim()
      ? `Korisnik želi izmjene plana: ${feedback.trim()}`
      : 'Korisnik još ne odobrava plan. Ostani u načinu planiranja i pitaj što treba promijeniti.',
  })

  return (
    <div className="ml-10 rounded-xl border border-accent/40 bg-accent-soft/20 p-3.5 fade-in">
      <div className="flex items-center gap-2 text-accent text-[13px] font-medium">
        <ClipboardList size={16} /> Plan je spreman za pregled
      </div>
      <div className="mt-2.5 bg-bg rounded-lg p-3.5 border border-border max-h-[28rem] overflow-auto">
        {plan ? <Markdown text={plan} /> : <pre className="font-mono text-[12px] whitespace-pre-wrap">{JSON.stringify(req.input, null, 2)}</pre>}
      </div>
      <input value={feedback} onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && feedback.trim()) void keepPlanning() }}
        placeholder="Što treba promijeniti u planu? (opcionalno)" className={`${field} mt-3`} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => approve('acceptEdits')} className={primary} title="Claude kreće s provedbom; izmjene datoteka više ne traže odobrenje">
          Odobri i prihvaćaj izmjene
        </button>
        <button onClick={() => approve('default')} className={secondary} title="Claude kreće s provedbom; svaka izmjena i dalje traži odobrenje">
          Odobri, pitaj za svaku izmjenu
        </button>
        <button onClick={keepPlanning} className={`${secondary} text-fg-muted`}>Nastavi planirati</button>
      </div>
    </div>
  )
}

export default function PermissionCard({ req }: { req: PermissionRequest }) {
  if (req.toolName === 'AskUserQuestion') return <QuestionCard req={req} />
  if (req.toolName === 'ExitPlanMode') return <PlanCard req={req} />
  return <ToolPermissionCard req={req} />
}

function ToolPermissionCard({ req }: { req: PermissionRequest }) {
  const answer = useAnswer(req)
  const [reason, setReason] = useState('')
  const canRemember = !!req.suggestions?.length
  const edits = editsOf({ type: 'tool_use', id: '', name: req.toolName, input: req.input, inputJson: '' })
  const deny = () => answer({ behavior: 'deny', message: reason.trim() ? `Korisnik je odbio ovaj alat. Razlog: ${reason.trim()}` : 'Korisnik je odbio ovaj alat' })

  return (
    <div className="ml-10 rounded-xl border border-warn/40 bg-warn/5 p-3.5 fade-in">
      <div className="flex items-center gap-2 text-warn text-[13px] font-medium">
        <ShieldAlert size={16} /> Claude želi pokrenuti <span className="font-mono">{req.toolName}</span>
      </div>
      <pre className="mt-2.5 font-mono text-[12.5px] whitespace-pre-wrap break-all bg-bg rounded-lg p-2.5 border border-border max-h-56 overflow-auto">
        {describe(req)}
      </pre>
      {edits && (
        <div className="mt-2 space-y-2">
          {edits.pairs.map((p, i) => <DiffView key={i} oldText={p.old} newText={p.new} numbered={req.toolName === 'Write'} />)}
        </div>
      )}
      {req.blockedPath && (
        <div className="mt-2 text-[12px] text-fg-muted">Putanja izvan radne mape: <span className="font-mono">{req.blockedPath}</span></div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => answer({ behavior: 'allow' })} className={primary}>Dopusti</button>
        {canRemember && (
          <button onClick={() => answer({ behavior: 'allow', updatedPermissions: req.suggestions })} className={secondary}>
            Dopusti i zapamti
          </button>
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void deny() }}
          placeholder="Razlog odbijanja ili uputa što da napravi umjesto toga (opcionalno)" className={field} />
        <button onClick={deny} className={`${secondary} shrink-0 text-fg-muted hover:text-danger hover:border-danger/50`}>Odbij</button>
      </div>
    </div>
  )
}
