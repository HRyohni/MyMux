import { useState } from 'react'
import { Plug, ExternalLink } from 'lucide-react'
import { useStore } from '../store'
import type { ElicitationRequest, ElicitationAnswer, ElicitationValue } from '../../../shared/ipc'

interface Field {
  key: string
  title: string
  description?: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  options?: { value: string; label: string }[]
  required: boolean
}

/** The fields of a flat JSON-schema form, which is all the MCP elicitation spec allows. */
function fieldsOf(schema: Record<string, unknown> | undefined): Field[] {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : []
  return Object.entries(props).map(([key, p]) => {
    const values = Array.isArray(p.enum) ? (p.enum as string[]) : undefined
    const names = Array.isArray(p.enumNames) ? (p.enumNames as string[]) : undefined
    const oneOf = Array.isArray(p.oneOf) ? (p.oneOf as { const: string; title?: string }[]) : undefined
    const options = values?.map((v, i) => ({ value: v, label: names?.[i] ?? v })) ?? oneOf?.map((o) => ({ value: o.const, label: o.title ?? o.const }))
    const type = options ? 'enum' : p.type === 'boolean' ? 'boolean' : p.type === 'number' || p.type === 'integer' ? 'number' : 'string'
    return {
      key, type, options, required: required.includes(key),
      title: typeof p.title === 'string' ? p.title : key,
      description: typeof p.description === 'string' ? p.description : undefined,
    }
  })
}

const primary = 'px-3 py-1.5 rounded-lg bg-accent text-black text-[13px] font-medium hover:brightness-110 disabled:opacity-40'
const secondary = 'px-3 py-1.5 rounded-lg border border-border bg-bg-elev text-[13px] hover:bg-bg-elev2'
const input = 'w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-border-strong'

/** An MCP server asks the user for input mid-call: a small form, or a step to finish in the browser. */
export default function ElicitationCard({ req }: { req: ElicitationRequest }) {
  const resolve = useStore((s) => s.resolveElicitation)
  const fields = fieldsOf(req.schema)
  const [values, setValues] = useState<Record<string, ElicitationValue>>({})

  const answer = (a: ElicitationAnswer) => {
    resolve(req.sessionId, req.requestId)
    void window.aimux.answerElicitation(req.requestId, a)
  }
  const missing = fields.some((f) => f.required && f.type !== 'boolean' && (values[f.key] === undefined || values[f.key] === ''))
  const submit = () => {
    const content: Record<string, ElicitationValue> = {}
    for (const f of fields) {
      const v = values[f.key]
      if (f.type === 'boolean') content[f.key] = v === true
      else if (v !== undefined && v !== '') content[f.key] = f.type === 'number' ? Number(v) : v
    }
    answer({ action: 'accept', content })
  }

  return (
    <div className="ml-10 rounded-xl border border-accent/40 bg-accent-soft/20 p-3.5 fade-in space-y-3">
      <div className="flex items-center gap-2 text-accent text-[13px] font-medium">
        <Plug size={16} /> MCP server <span className="font-mono">{req.serverName}</span> traži unos
      </div>
      <div className="text-[13.5px] whitespace-pre-wrap">{req.message}</div>
      {req.mode === 'url' && req.url && (
        <a href={req.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-link underline break-all">
          <ExternalLink size={13} className="shrink-0" /> {req.url}
        </a>
      )}
      {req.mode === 'form' && fields.map((f) => (
        <label key={f.key} className="block">
          <span className="text-[12.5px] font-medium">{f.title}{f.required && <span className="text-danger"> *</span>}</span>
          {f.description && <span className="block text-[11.5px] text-fg-muted">{f.description}</span>}
          {f.type === 'boolean' ? (
            <input type="checkbox" checked={values[f.key] === true} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked }))} className="accent-accent mt-1.5 w-4 h-4 block" />
          ) : f.type === 'enum' ? (
            <select value={String(values[f.key] ?? '')} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={`${input} mt-1`}>
              <option value="">Odaberi…</option>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input type={f.type === 'number' ? 'number' : 'text'} value={String(values[f.key] ?? '')}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={`${input} mt-1`} />
          )}
        </label>
      ))}
      <div className="flex flex-wrap gap-2">
        {req.mode === 'url'
          ? <button onClick={() => answer({ action: 'accept' })} className={primary}>Gotovo, nastavi</button>
          : <button onClick={submit} disabled={missing} className={primary}>Pošalji</button>}
        <button onClick={() => answer({ action: 'decline' })} className={`${secondary} text-fg-muted`}>Odbij</button>
      </div>
    </div>
  )
}
