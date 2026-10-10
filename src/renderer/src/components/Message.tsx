import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Brain, ChevronRight, AlertCircle, Info } from 'lucide-react'
import type { ChatItem, Block } from '../store'
import ToolCard from './ToolCard'

function Markdown({ text }: { text: string }) {
  return (
    <div className="md text-[14.5px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text.trim()) return null
  return (
    <div className="text-fg-faint text-[13px]">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 hover:text-fg-muted">
        <Brain size={13} /> Razmišljanje
        <ChevronRight size={12} className={`transition ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="mt-2 pl-5 whitespace-pre-wrap italic leading-relaxed border-l border-border ml-1.5">{text}</div>}
    </div>
  )
}

function BlockView({ block, streaming }: { block: Block; streaming: boolean }) {
  if (block.type === 'text') return <Markdown text={block.text} />
  if (block.type === 'thinking') return <Thinking text={block.text} />
  return <ToolCard block={block} streaming={streaming} />
}

export default function Message({ item }: { item: ChatItem }) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end fade-in">
        <div className="max-w-[80%] bg-user rounded-2xl rounded-tr-md px-4 py-2.5 whitespace-pre-wrap text-[14.5px] leading-relaxed">
          {item.text}
        </div>
      </div>
    )
  }

  if (item.kind === 'assistant') {
    const visible = item.blocks.filter((b) => b.type === 'tool_use' || b.text.trim().length > 0)
    if (visible.length === 0 && !item.streaming) return null
    return (
      <div className="flex gap-3 fade-in">
        <div className="shrink-0 w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center text-[11px] font-bold mt-0.5 select-none">C</div>
        <div className="min-w-0 flex-1 space-y-3">
          {visible.map((b, i) => <BlockView key={b.type === 'tool_use' ? b.id : i} block={b} streaming={item.streaming} />)}
          {item.streaming && visible.length === 0 && (
            <div className="flex items-center gap-1 h-6 pl-1">
              <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse [animation-delay:.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-muted pulse [animation-delay:.4s]" />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (item.kind === 'result') {
    const secs = (item.durationMs / 1000).toFixed(1)
    return (
      <div className={`pl-10 text-[11.5px] ${item.isError ? 'text-danger' : 'text-fg-faint'} fade-in`}>
        {item.isError
          ? <span className="flex items-start gap-1.5"><AlertCircle size={13} className="mt-0.5 shrink-0" /> Greška: {item.text}</span>
          : <span>{secs}s · {item.turns} {item.turns === 1 ? 'korak' : 'koraka'} · ${item.costUsd.toFixed(4)}</span>}
      </div>
    )
  }

  return (
    <div className={`flex items-start gap-2 text-[13px] px-3 py-2 rounded-lg border fade-in
      ${item.level === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-border bg-bg-elev text-fg-muted'}`}>
      {item.level === 'error' ? <AlertCircle size={15} className="mt-0.5 shrink-0" /> : <Info size={15} className="mt-0.5 shrink-0" />}
      <span className="whitespace-pre-wrap break-words">{item.text}</span>
    </div>
  )
}
