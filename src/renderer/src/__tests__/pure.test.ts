import { describe, expect, it } from 'vitest'
import { diffLines, diffStats, collapseContext } from '../diff'
import {
  leaves, removeLeaf, paneOfSession, groupOfSession, serializeWorkspace, parseWorkspace, restoreGroups, type Group, type Layout,
} from '../layout'
import { comboOf, actionFor, DEFAULT_KEYS } from '../keys'
import { fuzzyScore, rankFiles } from '../../../shared/fuzzy'
import { pieIndexAt, pieLines, pieWedges } from '../../../shared/pie'
import { tuckOf, untuck } from '../layout'

describe('pie menu', () => {
  it('maps directions to wedges and leaves the hole empty', () => {
    expect(pieIndexAt(0, 0, 2)).toBe(-1)
    expect(pieIndexAt(-50, 0, 2)).toBe(0)
    expect(pieIndexAt(50, 0, 2)).toBe(1)
    expect(pieIndexAt(0, -50, 4)).toBe(0)
    expect(pieIndexAt(50, 0, 4)).toBe(1)
    expect(pieIndexAt(0, 50, 4)).toBe(2)
    expect(pieIndexAt(-50, 0, 4)).toBe(3)
    expect(pieIndexAt(50, 50, 1)).toBe(0)
    expect(pieIndexAt(50, 0, 0)).toBe(-1)
  })

  it('stays inside a wedge up to its edge, for every wedge count', () => {
    for (let n = 1; n <= 8; n++) {
      for (let deg = 0; deg < 360; deg += 7) {
        const i = pieIndexAt(50 * Math.cos(deg * Math.PI / 180), 50 * Math.sin(deg * Math.PI / 180), n)
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(n)
      }
    }
  })

  it('wraps labels and marks what does not fit', () => {
    expect(pieLines('where can i see/test', 12, 3)).toEqual(['where can i', 'see/test'])
    expect(pieLines('jedan dva tri cetiri', 5, 2)).toEqual(['jedan', 'dva…'])
    expect(pieLines('nevjerojatnodugarijec', 9, 2)).toEqual(['nevjeroj…'])
  })

  it('gives every wedge a path and its label', () => {
    const w = pieWedges(['jedan', 'dva', 'tri'])
    expect(w).toHaveLength(3)
    expect(w[1].lines[0].text).toBe('dva')
    expect(pieWedges(['sam'])[0].path).not.toContain('NaN')
  })
})

describe('tucking a pane', () => {
  const l = (id: string, s: string): Layout => ({ kind: 'leaf', id, sessionId: s })

  it('puts a pane back on its side of the split, next to a sibling subtree', () => {
    const inner: Layout = { kind: 'split', id: 's2', dir: 'vertical', a: l('p2', 'B'), b: l('p3', 'C') }
    const root: Layout = { kind: 'split', id: 's1', dir: 'horizontal', a: l('p1', 'A'), b: inner }
    const place = tuckOf(root, 'p1')!
    expect(place).toEqual({ splitId: 's1', dir: 'horizontal', side: 'a', sibling: 's2' })
    const rest = removeLeaf(root, 'p1')!
    expect(untuck(rest, { ...place, sessionId: 'A', paneId: 'p1' }, 'p2')).toEqual(root)
  })

  it('finds a place next to the fallback pane when the sibling is gone', () => {
    const t = { sessionId: 'A', paneId: 'p1', splitId: 's1', dir: 'vertical' as const, side: 'a' as const, sibling: 'gone' }
    const r = untuck(l('p9', 'Z'), t, 'p9')
    expect(r).toMatchObject({ kind: 'split', dir: 'vertical', a: { id: 'p9' }, b: { id: 'p1', sessionId: 'A' } })
  })

  it('has nothing to tuck from a single pane', () => {
    expect(tuckOf(l('p1', 'A'), 'p1')).toBeNull()
  })
})

describe('diff', () => {
  it('marks only the changed lines', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc')
    expect(d.map((l) => `${l.type}:${l.text}`)).toEqual(['same:a', 'del:b', 'add:B', 'same:c'])
    expect(d[3]).toMatchObject({ oldNo: 3, newNo: 3 })
  })

  it('treats an empty old text as all additions', () => {
    expect(diffStats('', 'x\ny')).toEqual({ added: 2, removed: 0 })
    expect(diffStats('x\ny', '')).toEqual({ added: 0, removed: 2 })
    expect(diffLines('', '')).toEqual([])
  })

  it('ignores CRLF vs LF differences', () => {
    expect(diffStats('a\r\nb', 'a\nb')).toEqual({ added: 0, removed: 0 })
  })

  it('finds an insertion in the middle', () => {
    expect(diffStats('1\n2\n3\n4', '1\n2\nnovo\n3\n4')).toEqual({ added: 1, removed: 0 })
  })

  it('folds distant unchanged lines into gaps', () => {
    const old = Array.from({ length: 20 }, (_v, i) => `l${i}`)
    const next = [...old]
    next[10] = 'promjena'
    const rows = collapseContext(diffLines(old.join('\n'), next.join('\n')), 2)
    expect(rows[0]).toEqual({ type: 'gap', hidden: 8 })
    expect(rows.filter((r) => r.type !== 'gap')).toHaveLength(6)
    expect(rows[rows.length - 1]).toEqual({ type: 'gap', hidden: 7 })
  })
})

const leaf = (id: string, sessionId: string | null = null): Layout => ({ kind: 'leaf', id, sessionId })
const split = (id: string, a: Layout, b: Layout): Layout => ({ kind: 'split', id, dir: 'horizontal', a, b })

describe('layout', () => {
  const tree = split('s1', leaf('p1', 'A'), split('s2', leaf('p2'), leaf('p3', 'B')))

  it('lists leaves in order and finds sessions', () => {
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2', 'p3'])
    expect(paneOfSession(tree, 'B')).toBe('p3')
    expect(paneOfSession(tree, 'Z')).toBeNull()
  })

  it('collapses a split when one side is removed', () => {
    expect(leaves(removeLeaf(tree, 'p2') as Layout).map((l) => l.id)).toEqual(['p1', 'p3'])
    expect(removeLeaf(leaf('only'), 'only')).toBeNull()
  })

  it('finds the group showing a session', () => {
    const groups: Group[] = [
      { id: 'g1', name: 'Grupa 1', layout: leaf('x'), focusedPane: 'x' },
      { id: 'g2', name: 'Grupa 2', layout: tree, focusedPane: 'p1' },
    ]
    expect(groupOfSession(groups, 'B')?.id).toBe('g2')
    expect(groupOfSession(groups, 'Z')).toBeNull()
  })
})

describe('workspace persistence', () => {
  const groups: Group[] = [{ id: 'g1', name: 'Rad', layout: split('s1', leaf('p1', 'A'), leaf('p2', 'B')), focusedPane: 'p2' }]
  const meta = (id: string, sdk?: string) => ({ id, sdkSessionId: sdk, cwd: `C:/${id}`, title: id, permissionMode: 'default' as const, running: false, createdAt: 0 })
  const state = {
    groups, activeGroup: 'g1', order: ['B', 'A', 'gone'],
    sessions: { A: { meta: meta('A', 'sdk-a'), browserOpen: true }, B: { meta: meta('B'), browserOpen: false } },
  }

  it('round-trips through JSON', () => {
    const saved = parseWorkspace(JSON.stringify(serializeWorkspace(state)))
    expect(saved?.order).toEqual(['B', 'A'])
    expect(saved?.sessions.find((s) => s.key === 'A')).toMatchObject({ sdkSessionId: 'sdk-a', browserOpen: true, cwd: 'C:/A' })
  })

  it('remaps reopened sessions and empties panes of the ones that failed', () => {
    const saved = parseWorkspace(JSON.stringify(serializeWorkspace(state)))!
    const r = restoreGroups(saved, new Map([['A', 'new-a']]))
    expect(leaves(r.groups[0].layout).map((l) => l.sessionId)).toEqual(['new-a', null])
    expect(r.groups[0].focusedPane).toBe('p2')
    expect(r.order).toEqual(['new-a'])
    expect(r.activeGroup).toBe('g1')
  })

  it('rejects missing, corrupt and structurally invalid data', () => {
    expect(parseWorkspace(null)).toBeNull()
    expect(parseWorkspace('{not json')).toBeNull()
    expect(parseWorkspace(JSON.stringify({ v: 2, groups, sessions: [] }))).toBeNull()
    expect(parseWorkspace(JSON.stringify({ v: 1, groups: [{ id: 'g', name: 'x', layout: { kind: 'split', id: 's' } }], sessions: [] }))).toBeNull()
  })

  it('falls back when the saved focus or active group no longer exists', () => {
    const saved = parseWorkspace(JSON.stringify({ ...serializeWorkspace(state), activeGroup: 'nema', groups: [{ ...groups[0], focusedPane: 'nema' }] }))!
    const r = restoreGroups(saved, new Map())
    expect(r.activeGroup).toBe('g1')
    expect(r.groups[0].focusedPane).toBe('p1')
  })
})

describe('keys', () => {
  const ev = (key: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

  it('names combos consistently', () => {
    expect(comboOf(ev('t', { ctrlKey: true }))).toBe('Ctrl+T')
    expect(comboOf(ev('W', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+W')
    expect(comboOf(ev('|', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+\\')
    expect(comboOf(ev('Tab', { ctrlKey: true }))).toBe('Ctrl+Tab')
    expect(comboOf(ev('Control', { ctrlKey: true }))).toBe('')
  })

  it('maps default combos to actions', () => {
    expect(actionFor('Ctrl+T', DEFAULT_KEYS)).toBe('newGroup')
    expect(actionFor('Ctrl+Shift+\\', DEFAULT_KEYS)).toBe('splitDown')
    expect(actionFor('Ctrl+F', DEFAULT_KEYS)).toBe('find')
    expect(actionFor('Ctrl+Q', DEFAULT_KEYS)).toBeNull()
  })

  it('honours rebinding and never fires on plain typing', () => {
    const keys = { ...DEFAULT_KEYS, newChat: 'Alt+N' }
    expect(actionFor('Alt+N', keys)).toBe('newChat')
    expect(actionFor('Ctrl+N', keys)).toBeNull()
    expect(actionFor('N', { ...DEFAULT_KEYS, newChat: 'N' })).toBeNull()
    expect(actionFor('Shift+N', { ...DEFAULT_KEYS, newChat: 'Shift+N' })).toBeNull()
  })
})

describe('file search ranking', () => {
  const files = ['src/main/agent.ts', 'src/renderer/src/store.ts', 'README.md', 'src/renderer/src/components/Chat.tsx', 'docs/storage.md']

  it('prefers file-name matches and drops non-matches', () => {
    expect(rankFiles(files, 'store', 10)[0]).toBe('src/renderer/src/store.ts')
    expect(rankFiles(files, 'zzz', 10)).toEqual([])
    expect(fuzzyScore('src/main/agent.ts', 'xq')).toBe(-1)
  })

  it('matches subsequences across directories and accepts backslashes', () => {
    expect(rankFiles(files, 'rcchat', 10)).toContain('src/renderer/src/components/Chat.tsx')
    expect(rankFiles(files, 'main\\agent', 10)).toEqual(['src/main/agent.ts'])
  })

  it('returns the head of the list for an empty query', () => {
    expect(rankFiles(files, '', 2)).toEqual(files.slice(0, 2))
  })
})
