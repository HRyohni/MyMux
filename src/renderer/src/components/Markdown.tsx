import { isValidElement, memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import { Check, Copy } from 'lucide-react'

export function CopyButton({ text, title = 'Kopiraj', className = '' }: { text: string | (() => string); title?: string; className?: string }) {
  const [done, setDone] = useState(false)
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(typeof text === 'function' ? text() : text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    }).catch(() => {})
  }
  return (
    <button onClick={copy} title={title}
      className={`w-6 h-6 rounded-md flex items-center justify-center text-fg-faint hover:text-fg hover:bg-bg-elev2 ${className}`}>
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  )
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))

/** highlight.js output for a known language; plain escaped text otherwise (no guessing). */
export function highlight(code: string, lang?: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value } catch { /* fall through */ }
  }
  return escapeHtml(code)
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const html = useMemo(() => highlight(code, lang), [code, lang])
  return (
    <div className="rounded-[10px] border border-border overflow-hidden bg-bg-code">
      <div className="flex items-center h-7 pl-3 pr-1 border-b border-border text-[11px] text-fg-faint font-mono select-none">
        <span className="flex-1">{lang || 'tekst'}</span>
        <CopyButton text={code} title="Kopiraj kod" />
      </div>
      <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  )
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md text-[14.5px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          pre: ({ children }) => {
            const child = Array.isArray(children) ? children[0] : children
            if (!isValidElement(child)) return <pre>{children}</pre>
            const props = child.props as { className?: string; children?: unknown }
            const lang = /language-([\w+#-]+)/.exec(props.className ?? '')?.[1]
            return <CodeBlock code={String(props.children ?? '').replace(/\n$/, '')} lang={lang} />
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
