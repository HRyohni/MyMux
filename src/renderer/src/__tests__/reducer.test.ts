import { describe, expect, it } from 'vitest'
import { reduce, displayPrompt, latestTodos, changedFiles, changedFileCount, updateTool, type ChatItem } from '../reducer'
import type { SDKMessage } from '../../../shared/ipc'

const msg = (m: unknown) => m as SDKMessage
const stream = (event: unknown, parent: string | null = null) => msg({ type: 'stream_event', event, parent_tool_use_id: parent })
const run = (msgs: SDKMessage[], start: ChatItem[] = []) => msgs.reduce(reduce, start)

const assistantWith = (blocks: unknown[], parent: string | null = null) =>
  msg({ type: 'assistant', message: { content: blocks }, parent_tool_use_id: parent, uuid: 'a1' })
const toolResult = (id: string, content: unknown, isError = false, parent: string | null = null) =>
  msg({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }, parent_tool_use_id: parent })
const result = (total: number, isError = false) =>
  msg({ type: 'result', subtype: 'success', total_cost_usd: total, duration_ms: 1200, num_turns: 2, is_error: isError, result: 'boom' })

describe('streaming', () => {
  it('builds text from deltas and closes the message', () => {
    const items = run([
      stream({ type: 'message_start' }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bok' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' svima' } }),
      stream({ type: 'message_stop' }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'assistant', streaming: false, blocks: [{ type: 'text', text: 'Bok svima' }] })
  })

  it('parses tool input from partial JSON and attaches the result', () => {
    const items = run([
      stream({ type: 'message_start' }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Bash' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"ls"}' } }),
      stream({ type: 'content_block_stop', index: 0 }),
      stream({ type: 'message_stop' }),
      toolResult('t1', [{ type: 'text', text: 'a.txt' }]),
    ])
    const block = (items[0] as Extract<ChatItem, { kind: 'assistant' }>).blocks[0]
    expect(block).toMatchObject({ type: 'tool_use', input: { command: 'ls' }, result: { text: 'a.txt', isError: false } })
  })

  it('keeps unparseable tool input as raw text instead of throwing', () => {
    const items = run([
      stream({ type: 'message_start' }),
      stream({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Bash' } }),
      stream({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":' } }),
      stream({ type: 'content_block_stop', index: 0 }),
    ])
    expect((items[0] as Extract<ChatItem, { kind: 'assistant' }>).blocks[0]).toMatchObject({ input: { _raw: '{"command":' } })
  })

  it('ignores deltas when no message is open', () => {
    const items: ChatItem[] = []
    expect(reduce(items, stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }))).toBe(items)
  })
})

describe('history replay', () => {
  it('appends complete assistant messages when nothing is streaming', () => {
    const items = run([assistantWith([{ type: 'text', text: 'gotovo' }, { type: 'tool_use', id: 't9', name: 'Read', input: { file_path: 'a' } }])])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'assistant', streaming: false })
  })

  it('joins consecutive transcript entries into one reply and marks interrupts', () => {
    const items = run([
      assistantWith([{ type: 'text', text: 'prvo' }]),
      assistantWith([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]),
      toolResult('t1', 'sadržaj'),
      msg({ type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, parent_tool_use_id: null }),
      assistantWith([{ type: 'text', text: 'novi odgovor' }]),
    ])
    expect(items.map((i) => i.kind)).toEqual(['assistant', 'info', 'assistant'])
    expect((items[0] as Extract<ChatItem, { kind: 'assistant' }>).blocks).toHaveLength(2)
  })

  it('keeps the uuid of user prompts and splits images from text', () => {
    const items = run([msg({
      type: 'user', uuid: 'u-1', parent_tool_use_id: null,
      message: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'što je ovo' }] },
    })])
    expect(items[0]).toMatchObject({ kind: 'user', uuid: 'u-1', text: 'što je ovo', images: ['data:image/png;base64,AAA'] })
  })

  it('skips synthetic prompts and command output', () => {
    expect(run([msg({ type: 'user', message: { content: 'nastavi' }, parent_tool_use_id: null, isSynthetic: true })])).toHaveLength(0)
    expect(run([msg({ type: 'user', message: { content: '<local-command-stdout>ok</local-command-stdout>' }, parent_tool_use_id: null })])).toHaveLength(0)
  })
})

describe('displayPrompt', () => {
  it('shows stored slash commands the way they were typed', () => {
    expect(displayPrompt('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>samo api</command-args>'))
      .toBe('/compact samo api')
    expect(displayPrompt('<command-name>clear</command-name>')).toBe('/clear')
  })
  it('passes ordinary text through and drops empty text', () => {
    expect(displayPrompt('popravi bug')).toBe('popravi bug')
    expect(displayPrompt('   ')).toBeNull()
  })
})

describe('subagents', () => {
  const parent = run([assistantWith([{ type: 'tool_use', id: 'agent1', name: 'Agent', input: { description: 'istraži' } }])])

  it('nests subagent messages and their tool results under the Agent call', () => {
    const items = run([
      assistantWith([{ type: 'tool_use', id: 'sub1', name: 'Grep', input: { pattern: 'x' } }], 'agent1'),
      toolResult('sub1', 'nađeno', false, 'agent1'),
      assistantWith([{ type: 'text', text: 'zaključak' }], 'agent1'),
    ], parent)
    expect(items).toHaveLength(1)
    const agent = (items[0] as Extract<ChatItem, { kind: 'assistant' }>).blocks[0]
    if (agent.type !== 'tool_use') throw new Error('expected tool block')
    expect(agent.sub).toHaveLength(1)
    expect(agent.sub![0]).toMatchObject({ kind: 'assistant', blocks: [{ name: 'Grep', result: { text: 'nađeno' } }, { type: 'text', text: 'zaključak' }] })
  })

  it('reaches tool blocks two levels deep', () => {
    const nested = run([
      assistantWith([{ type: 'tool_use', id: 'agent2', name: 'Agent', input: {} }], 'agent1'),
      assistantWith([{ type: 'text', text: 'duboko' }], 'agent2'),
    ], parent)
    let seen = ''
    updateTool(nested, 'agent2', (b) => { seen = JSON.stringify(b.sub); return b })
    expect(seen).toContain('duboko')
  })

  it('leaves items untouched when the parent is unknown', () => {
    expect(reduce(parent, assistantWith([{ type: 'text', text: 'x' }], 'nema'))).toBe(parent)
  })
})

describe('result', () => {
  it('reports per-turn cost from the running total', () => {
    const items = run([result(0.1), result(0.25)])
    expect(items[0]).toMatchObject({ kind: 'result', costUsd: 0.1, totalCostUsd: 0.1 })
    expect((items[1] as Extract<ChatItem, { kind: 'result' }>).costUsd).toBeCloseTo(0.15)
  })

  it('treats a smaller total as a reset', () => {
    const items = run([result(0.5), result(0.02)])
    expect(items[1]).toMatchObject({ costUsd: 0.02, totalCostUsd: 0.02 })
  })

  it('closes a message that was still streaming and carries the error text', () => {
    const items = run([stream({ type: 'message_start' }), result(0, true)])
    expect(items[0]).toMatchObject({ kind: 'assistant', streaming: false })
    expect(items[1]).toMatchObject({ kind: 'result', isError: true, text: 'boom' })
  })
})

describe('system messages', () => {
  it('notes a compaction with token counts', () => {
    const items = run([msg({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 120000, post_tokens: 30000 } })])
    expect(items[0]).toMatchObject({ kind: 'info', text: 'Kontekst je sažet (/compact): 120k → 30k tokena' })
  })

  it('wipes the conversation on /clear', () => {
    const items = run([msg({ type: 'conversation_reset' })], run([result(0.1)]))
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('info')
  })

  it('shows local command output as markdown', () => {
    const items = run([msg({ type: 'system', subtype: 'local_command_output', content: '## Kontekst' })])
    expect(items[0]).toMatchObject({ kind: 'info', markdown: true })
  })
})

describe('derived views', () => {
  const tool = (id: string, name: string, input: unknown, res?: { text: string; isError: boolean }) => {
    const items = run([assistantWith([{ type: 'tool_use', id, name, input }])])
    return res ? run([toolResult(id, res.text, res.isError)], items) : items
  }

  it('returns the latest TodoWrite list', () => {
    const items = [
      ...tool('a', 'TodoWrite', { todos: [{ content: 'prvo', status: 'pending' }] }),
      ...tool('b', 'TodoWrite', { todos: [{ content: 'prvo', status: 'completed' }, { content: 'drugo', status: 'in_progress', activeForm: 'Radim drugo' }] }),
    ]
    expect(latestTodos(items).map((t) => t.status)).toEqual(['completed', 'in_progress'])
  })

  it('tracks TaskCreate and TaskUpdate', () => {
    const items = [
      ...tool('a', 'TaskCreate', { subject: 'testovi' }, { text: 'Task #1 created', isError: false }),
      ...tool('b', 'TaskCreate', { subject: 'dokumentacija' }, { text: 'Task #2 created', isError: false }),
      ...tool('c', 'TaskUpdate', { taskId: '1', status: 'completed' }),
      ...tool('d', 'TaskUpdate', { taskId: '2', status: 'deleted' }),
    ]
    expect(latestTodos(items)).toEqual([{ content: 'testovi', status: 'completed', activeForm: undefined }])
  })

  it('counts changed files only for edits that succeeded', () => {
    const items = [
      ...tool('a', 'Edit', { file_path: '/p/a.ts', old_string: 'x\ny', new_string: 'x\nz\nw' }, { text: 'ok', isError: false }),
      ...tool('b', 'Write', { file_path: '/p/b.ts', content: '1\n2\n3' }, { text: 'ok', isError: false }),
      ...tool('c', 'Edit', { file_path: '/p/c.ts', old_string: 'a', new_string: 'b' }, { text: 'nije nađeno', isError: true }),
      ...tool('d', 'Edit', { file_path: '/p/d.ts', old_string: 'a', new_string: 'b' }),
    ]
    expect(changedFileCount(items)).toBe(2)
    expect(changedFiles(items)).toEqual([
      { path: '/p/a.ts', edits: 1, added: 2, removed: 1, created: false },
      { path: '/p/b.ts', edits: 1, added: 3, removed: 0, created: true },
    ])
  })
})
