// Conversation → Markdown, for saving a readable copy. Pure, so it is unit-testable.
import type { ChatItem, ToolBlock } from './reducer'

function toolLine(b: ToolBlock): string {
  const i = (b.input ?? {}) as Record<string, unknown>
  const arg = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'path']
    .map((k) => (typeof i[k] === 'string' ? (i[k] as string) : ''))
    .find(Boolean) ?? ''
  const state = b.result ? (b.result.isError ? ' (greška)' : '') : ' (bez rezultata)'
  return `- **${b.name}** ${arg ? `\`${arg.replace(/`/g, "'").replace(/\s+/g, ' ').slice(0, 160)}\`` : ''}${state}`
}

function itemsToMarkdown(items: ChatItem[], depth: number): string[] {
  const out: string[] = []
  const quote = (s: string) => (depth ? s.split('\n').map((l) => `> ${l}`).join('\n') : s)
  for (const it of items) {
    if (it.kind === 'user') {
      const images = it.images?.length ? `\n\n_(${it.images.length} ${it.images.length === 1 ? 'slika' : 'slike'})_` : ''
      out.push(quote(`## Korisnik\n\n${it.text}${images}`))
    } else if (it.kind === 'assistant') {
      const parts: string[] = []
      for (const b of it.blocks) {
        if (b.type === 'text' && b.text.trim()) parts.push(b.text.trim())
        else if (b.type === 'tool_use') {
          parts.push(toolLine(b))
          if (b.sub?.length) parts.push(itemsToMarkdown(b.sub, depth + 1).join('\n\n'))
        }
      }
      if (parts.length) out.push(quote(`## Claude\n\n${parts.join('\n\n')}`))
    } else if (it.kind === 'info') {
      out.push(quote(`_${it.text.replace(/\n+/g, ' ')}_`))
    } else if (it.kind === 'result' && it.isError) {
      out.push(quote(`**Greška:** ${it.text ?? ''}`))
    }
  }
  return out
}

/** Readable transcript: prompts and replies in full, tool calls as one line each, thinking left out. */
export function toMarkdown(items: ChatItem[], meta: { title: string; cwd: string; model?: string }): string {
  const head = [`# ${meta.title}`, `Radna mapa: \`${meta.cwd}\`${meta.model ? ` · Model: ${meta.model}` : ''}`]
  return [...head, ...itemsToMarkdown(items, 0)].join('\n\n') + '\n'
}
