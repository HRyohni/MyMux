import { useMemo, useState } from 'react'
import {
  Terminal, FileText, FilePen, FilePlus, Search, FolderSearch, Globe, Bot, ListTodo, Wrench,
  ChevronRight, Check, X, Loader2, MessageCircleQuestion, ClipboardList, Circle, CircleCheck, CircleDot, ExternalLink,
} from 'lucide-react'
import { useOpenFile } from './SessionContext'
import type { ToolBlock } from '../store'
import { editsOf, type TodoEntry } from '../reducer'
import { diffStats } from '../diff'
import DiffView from './DiffView'
import Markdown from './Markdown'
import Message from './Message'

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Bash: Terminal, PowerShell: Terminal, Read: FileText, Edit: FilePen, MultiEdit: FilePen, Write: FilePlus, NotebookEdit: FilePen,
  Grep: Search, Glob: FolderSearch, WebFetch: Globe, WebSearch: Globe, Agent: Bot, Task: Bot, TodoWrite: ListTodo,
  TaskCreate: ListTodo, TaskUpdate: ListTodo, AskUserQuestion: MessageCircleQuestion, ExitPlanMode: ClipboardList,
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** One-line human summary of a tool call. */
function summarize(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (name.startsWith('mcp__aimux__browser_')) {
    if (i.ref) return `${i.ref}${i.text ? `  "${i.text}"` : ''}`
    return str(i.url) ?? str(i.path) ?? str(i.key) ?? str(i.script) ?? str(i.direction) ?? str(i.action) ?? ''
  }
  switch (name) {
    case 'Bash': case 'PowerShell': return str(i.description) ?? str(i.command) ?? ''
    case 'Read': case 'Write': case 'Edit': case 'MultiEdit': return str(i.file_path) ?? ''
    case 'NotebookEdit': return str(i.notebook_path) ?? ''
    case 'Grep': return `${str(i.pattern) ?? ''}${i.path ? `  u ${i.path}` : ''}`
    case 'Glob': return str(i.pattern) ?? ''
    case 'WebFetch': return str(i.url) ?? ''
    case 'WebSearch': return str(i.query) ?? ''
    case 'Agent': case 'Task': return str(i.description) ?? ''
    case 'TodoWrite': {
      const todos = Array.isArray(i.todos) ? (i.todos as TodoEntry[]) : []
      return `${todos.filter((t) => t.status === 'completed').length}/${todos.length} dovršeno`
    }
    case 'TaskCreate': return str(i.subject) ?? ''
    case 'TaskUpdate': return `#${str(i.taskId) ?? ''}${i.status ? ` → ${i.status}` : ''}`
    case 'AskUserQuestion': {
      const q = Array.isArray(i.questions) ? (i.questions as { question?: string }[]) : []
      return q.map((x) => x.question).filter(Boolean).join(' · ')
    }
    case 'ExitPlanMode': return 'plan spreman za pregled'
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string') as string | undefined
      return first ?? ''
    }
  }
}

function pretty(v: unknown): string {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

export function TodoList({ todos }: { todos: TodoEntry[] }) {
  return (
    <ul className="space-y-1 text-[13px]">
      {todos.map((t, i) => (
        <li key={i} className={`flex items-start gap-2 ${t.status === 'completed' ? 'text-fg-faint line-through' : t.status === 'in_progress' ? 'text-fg' : 'text-fg-muted'}`}>
          <span className="mt-[3px] shrink-0">
            {t.status === 'completed' ? <CircleCheck size={14} className="text-ok" />
              : t.status === 'in_progress' ? <CircleDot size={14} className="text-accent" />
              : <Circle size={14} />}
          </span>
          <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
        </li>
      ))}
    </ul>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] uppercase tracking-wider text-fg-faint mb-1">{children}</div>
)

export default function ToolCard({ block, streaming }: { block: ToolBlock; streaming: boolean }) {
  const isTodo = block.name === 'TodoWrite'
  const [open, setOpen] = useState(false)
  const isBrowser = block.name.startsWith('mcp__aimux__browser_')
  const Icon = isBrowser ? Globe : (ICONS[block.name] ?? Wrench)
  const label = isBrowser ? `Browser · ${block.name.slice('mcp__aimux__browser_'.length).replace(/_/g, ' ')}` : block.name
  const summary = summarize(block.name, block.input)
  const done = !!block.result
  const failed = block.result?.isError
  const pendingInput = streaming && !block.inputJson.trim().endsWith('}')
  const input = (block.input ?? {}) as Record<string, unknown>

  const cmd = block.name === 'Bash' || block.name === 'PowerShell' ? str(input.command) : undefined
  const edits = useMemo(() => editsOf(block), [block])
  const stats = useMemo(() => {
    if (!edits) return null
    return edits.pairs.reduce((acc, p) => {
      const s = diffStats(p.old, p.new)
      return { added: acc.added + s.added, removed: acc.removed + s.removed }
    }, { added: 0, removed: 0 })
  }, [edits])
  const todos = isTodo && Array.isArray(input.todos) ? (input.todos as TodoEntry[]) : null
  const isAgent = block.name === 'Agent' || block.name === 'Task'
  const plan = block.name === 'ExitPlanMode' ? str(input.plan) : undefined
  const openFile = useOpenFile()
  const filePath = ['Read', 'Edit', 'MultiEdit', 'Write'].includes(block.name) ? str(input.file_path) : undefined

  return (
    <div className={`rounded-xl border text-[13px] overflow-hidden transition
      ${failed ? 'border-danger/40' : 'border-border'} bg-bg-elev`}>
      <div role="button" tabIndex={0} onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left cursor-pointer hover:bg-bg-elev2/60">
        <span className="shrink-0 text-fg-muted"><Icon size={15} /></span>
        <span className="font-medium shrink-0">{label}</span>
        <span className="truncate text-fg-muted font-mono text-[12.5px] flex-1">{summary}</span>
        {filePath && openFile && (
          <button onClick={(e) => { e.stopPropagation(); openFile(filePath) }} title="Otvori datoteku u browser panelu"
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg hover:bg-bg-elev2">
            <ExternalLink size={13} />
          </button>
        )}
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="shrink-0 font-mono text-[11.5px]">
            <span className="text-ok">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
          </span>
        )}
        {isAgent && block.sub && block.sub.length > 0 && <span className="shrink-0 text-[11.5px] text-fg-faint">{block.sub.length} koraka</span>}
        <span className="shrink-0 text-fg-faint">
          {failed ? <X size={14} className="text-danger" />
            : done ? <Check size={14} className="text-ok" />
            : pendingInput || !done ? <Loader2 size={14} className="animate-spin" /> : null}
        </span>
        <ChevronRight size={14} className={`shrink-0 text-fg-faint transition ${open ? 'rotate-90' : ''}`} />
      </div>

      {/* The task list is the point of a TodoWrite call, so it shows without expanding. */}
      {todos && todos.length > 0 && !open && (
        <div className="border-t border-border px-3 py-2.5"><TodoList todos={todos} /></div>
      )}

      {open && (
        <div className="border-t border-border px-3 py-2.5 space-y-3 fade-in">
          <div>
            <Label>{edits ? 'Izmjena' : plan ? 'Plan' : todos ? 'Zadaci' : 'Ulaz'}</Label>
            {cmd ? (
              <pre className="font-mono text-[12.5px] whitespace-pre-wrap break-all bg-bg rounded-lg p-2.5 border border-border">{cmd}</pre>
            ) : edits ? (
              <div className="space-y-2">
                {edits.pairs.map((p, i) => <DiffView key={i} oldText={p.old} newText={p.new} numbered={block.name === 'Write'} />)}
              </div>
            ) : todos ? (
              <TodoList todos={todos} />
            ) : plan ? (
              <div className="bg-bg rounded-lg p-3 border border-border max-h-96 overflow-auto"><Markdown text={plan} /></div>
            ) : isAgent && str(input.prompt) ? (
              <pre className="font-mono text-[12px] whitespace-pre-wrap break-words bg-bg rounded-lg p-2.5 border border-border max-h-48 overflow-auto text-fg-muted">{str(input.prompt)}</pre>
            ) : (
              <pre className="font-mono text-[12px] whitespace-pre-wrap break-all bg-bg rounded-lg p-2.5 border border-border max-h-64 overflow-auto">{pretty(block.input)}</pre>
            )}
          </div>
          {block.sub && block.sub.length > 0 && (
            <div>
              <Label>Podagent{str(input.subagent_type) ? ` · ${str(input.subagent_type)}` : ''}</Label>
              <div className="border-l-2 border-border-strong pl-3 space-y-3 max-h-[32rem] overflow-auto">
                {/* The first user item repeats the prompt shown above. */}
                {block.sub.filter((it, i) => !(i === 0 && it.kind === 'user')).map((it) => <Message key={it.id} item={it} nested />)}
              </div>
            </div>
          )}
          {block.result && (
            <div>
              <Label>{failed ? 'Greška' : 'Rezultat'}</Label>
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
