import { useState } from 'react'
import {
  Terminal, FileText, FilePen, FilePlus, Search, FolderSearch, Globe, Bot, ListTodo, Wrench,
  ChevronRight, Check, X, Loader2,
} from 'lucide-react'
import type { Block } from '../store'

type ToolBlock = Extract<Block, { type: 'tool_use' }>

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Bash: Terminal, PowerShell: Terminal, Read: FileText, Edit: FilePen, MultiEdit: FilePen, Write: FilePlus,
  Grep: Search, Glob: FolderSearch, WebFetch: Globe, WebSearch: Globe, Agent: Bot, Task: Bot, TodoWrite: ListTodo,
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** One-line human summary of a tool call. */
function summarize(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (name.startsWith('mcp__aimux__browser_')) {
    if (i.ref) return `${i.ref}${i.text ? `  "${i.text}"` : ''}`
    return str(i.url) ?? str(i.path) ?? str(i.key) ?? str(i.script) ?? str(i.direction) ?? ''
  }
  switch (name) {
    case 'Bash': case 'PowerShell': return str(i.description) ?? str(i.command) ?? ''
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return str(i.file_path) ?? ''
    case 'Grep': return `${str(i.pattern) ?? ''}${i.path ? `  u ${i.path}` : ''}`
    case 'Glob': return str(i.pattern) ?? ''
    case 'WebFetch': return str(i.url) ?? ''
    case 'WebSearch': return str(i.query) ?? ''
    case 'Agent': case 'Task': return str(i.description) ?? ''
    case 'TodoWrite': return 'ažuriranje liste zadataka'
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string') as string | undefined
      return first ?? ''
    }
  }
}

function pretty(v: unknown): string {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

export default function ToolCard({ block, streaming }: { block: ToolBlock; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const isBrowser = block.name.startsWith('mcp__aimux__browser_')
  const Icon = isBrowser ? Globe : (ICONS[block.name] ?? Wrench)
  const label = isBrowser ? `Browser · ${block.name.slice('mcp__aimux__browser_'.length).replace(/_/g, ' ')}` : block.name
  const summary = summarize(block.name, block.input)
  const done = !!block.result
  const failed = block.result?.isError
  const pendingInput = streaming && !block.inputJson.trim().endsWith('}')

  const cmd = block.name === 'Bash' || block.name === 'PowerShell' ? str((block.input as Record<string, unknown>)?.command) : undefined
  const edit = block.name === 'Edit' ? (block.input as { old_string?: string; new_string?: string }) : undefined

  return (
    <div className={`rounded-xl border text-[13px] overflow-hidden transition
      ${failed ? 'border-danger/40' : 'border-border'} bg-bg-elev`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-elev2/60">
        <span className="shrink-0 text-fg-muted"><Icon size={15} /></span>
        <span className="font-medium shrink-0">{label}</span>
        <span className="truncate text-fg-muted font-mono text-[12.5px] flex-1">{summary}</span>
        <span className="shrink-0 text-fg-faint">
          {failed ? <X size={14} className="text-danger" />
            : done ? <Check size={14} className="text-ok" />
            : pendingInput || !done ? <Loader2 size={14} className="animate-spin" /> : null}
        </span>
        <ChevronRight size={14} className={`shrink-0 text-fg-faint transition ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2.5 space-y-3 fade-in">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-fg-faint mb-1">Ulaz</div>
            {cmd ? (
              <pre className="font-mono text-[12.5px] whitespace-pre-wrap break-all bg-bg rounded-lg p-2.5 border border-border">{cmd}</pre>
            ) : edit?.old_string !== undefined ? (
              <div className="font-mono text-[12.5px] rounded-lg overflow-hidden border border-border">
                <pre className="whitespace-pre-wrap break-all bg-danger/10 text-danger/90 p-2.5">- {edit.old_string}</pre>
                <pre className="whitespace-pre-wrap break-all bg-ok/10 text-ok/90 p-2.5">+ {edit.new_string}</pre>
              </div>
            ) : (
              <pre className="font-mono text-[12px] whitespace-pre-wrap break-all bg-bg rounded-lg p-2.5 border border-border max-h-64 overflow-auto">{pretty(block.input)}</pre>
            )}
          </div>
          {block.subLog && block.subLog.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-fg-faint mb-1">Podagent</div>
              <div className="font-mono text-[12px] whitespace-pre-wrap break-words bg-bg rounded-lg p-2.5 border border-border max-h-64 overflow-auto text-fg-muted space-y-0.5">
                {block.subLog.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
          )}
          {block.result && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-fg-faint mb-1">{failed ? 'Greška' : 'Rezultat'}</div>
              <pre className={`font-mono text-[12px] whitespace-pre-wrap break-all rounded-lg p-2.5 border max-h-80 overflow-auto
                ${failed ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-bg border-border text-fg-muted'}`}>
                {block.result.text.length > 20000 ? block.result.text.slice(0, 20000) + '\n… (skraćeno)' : block.result.text || '(prazno)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
