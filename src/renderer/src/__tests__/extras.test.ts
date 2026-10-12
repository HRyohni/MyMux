import { describe, expect, it } from 'vitest'
import { reduce, unloadedAgents, withSubagent, type ChatItem } from '../reducer'
import { toMarkdown } from '../export'
import type { SDKMessage } from '../../../shared/ipc'

const msg = (m: unknown) => m as SDKMessage
const run = (msgs: SDKMessage[], start: ChatItem[] = []) => msgs.reduce(reduce, start)
const assistant = (blocks: unknown[]) => msg({ type: 'assistant', message: { content: blocks }, parent_tool_use_id: null })
const user = (text: string) => msg({ type: 'user', message: { content: text }, parent_tool_use_id: null })
const toolResult = (id: string, text: string) =>
  msg({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, parent_tool_use_id: null })

describe('hook events', () => {
  const hook = (outcome: string) => msg({ type: 'system', subtype: 'hook_response', hook_name: 'lint', hook_event: 'PostToolUse', outcome, stderr: 'exit 2', output: '' })

  it('reports a failed hook with its stderr', () => {
    const items = run([hook('error')])
    expect(items[0]).toMatchObject({ kind: 'info', level: 'error' })
    expect((items[0] as Extract<ChatItem, { kind: 'info' }>).text).toContain('lint (PostToolUse)')
    expect((items[0] as Extract<ChatItem, { kind: 'info' }>).text).toContain('exit 2')
  })

  it('stays silent for hooks that succeed', () => {
    expect(run([hook('success')])).toHaveLength(0)
  })
})

describe('subagent history', () => {
  const resumed = run([
    assistant([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'istraži' } }, { type: 'tool_use', id: 'r1', name: 'Read', input: {} }]),
    toolResult('a1', 'Zaključak.\nagentId: abc-123 (use SendMessage to continue)'),
    toolResult('r1', 'agentId: nije-agent'),
  ])

  it('finds Agent calls whose transcript is missing, by the id in their result', () => {
    expect(unloadedAgents(resumed)).toEqual([{ toolId: 'a1', agentId: 'abc-123' }])
  })

  it('attaches a stored transcript and stops reporting the call as unloaded', () => {
    const loaded = withSubagent(resumed, 'a1', [
      { type: 'user', message: { content: 'istraži kod' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'našao sam' }] } },
      { type: 'system', message: {} },
    ])
    const agent = (loaded[0] as Extract<ChatItem, { kind: 'assistant' }>).blocks[0]
    if (agent.type !== 'tool_use') throw new Error('expected tool block')
    expect(agent.sub?.map((i) => i.kind)).toEqual(['user', 'assistant'])
    expect(unloadedAgents(loaded)).toEqual([])
  })

  it('leaves items untouched when the transcript is empty', () => {
    expect(withSubagent(resumed, 'a1', [])).toBe(resumed)
  })
})

describe('markdown export', () => {
  const items = run([
    user('popravi `bug`'),
    assistant([
      { type: 'thinking', thinking: 'tajno' },
      { type: 'text', text: 'Evo popravka.' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm   test' } },
      { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/a.ts' } },
    ]),
    toolResult('t1', 'ok'),
  ])
  const md = toMarkdown(items, { title: 'Popravak', cwd: 'C:/p', model: 'opus' })

  it('has a header, both speakers and one line per tool call', () => {
    expect(md.startsWith('# Popravak\n\nRadna mapa: `C:/p` · Model: opus')).toBe(true)
    expect(md).toContain('## Korisnik\n\npopravi `bug`')
    expect(md).toContain('## Claude\n\nEvo popravka.')
    expect(md).toContain('- **Bash** `npm test`')
    expect(md).toContain('- **Edit** `src/a.ts` (bez rezultata)')
  })

  it('leaves thinking out', () => {
    expect(md).not.toContain('tajno')
  })

  it('quotes a subagent transcript under its Agent call', () => {
    const withAgent = withSubagent(
      run([assistant([{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'traži' } }])]),
      'a1', [{ type: 'assistant', message: { content: [{ type: 'text', text: 'nalaz' }] } }],
    )
    expect(toMarkdown(withAgent, { title: 't', cwd: 'c' })).toContain('> ## Claude\n> \n> nalaz')
  })
})
