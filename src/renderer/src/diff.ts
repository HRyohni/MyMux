// Line diff used by the Edit/Write tool cards and the changed-files overview.

export interface DiffLine { type: 'same' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number }

/** Above this many cell comparisons the LCS table is skipped and the middle is shown as replaced. */
const MAX_CELLS = 4_000_000

/** Lines of a text; a final newline ends the last line instead of starting an empty one. */
function split(s: string): string[] {
  if (s === '') return []
  const lines = s.replace(/\r\n/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = split(oldText)
  const b = split(newText)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }

  const out: DiffLine[] = []
  let oldNo = 1
  let newNo = 1
  const same = (text: string) => out.push({ type: 'same', text, oldNo: oldNo++, newNo: newNo++ })
  const del = (text: string) => out.push({ type: 'del', text, oldNo: oldNo++ })
  const add = (text: string) => out.push({ type: 'add', text, newNo: newNo++ })

  for (let i = 0; i < start; i++) same(a[i])

  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) del(a[i])
    for (let j = start; j < endB; j++) add(b[j])
  } else {
    // lcs[i][j] = length of the longest common subsequence of a[start+i..] and b[start+j..]
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = a[start + i] === b[start + j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) { same(a[start + i]); i++; j++ }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) del(a[start + i++])
      else add(b[start + j++])
    }
    while (i < n) del(a[start + i++])
    while (j < m) add(b[start + j++])
  }

  for (let i = endA; i < a.length; i++) same(a[i])
  return out
}

export function diffStats(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of diffLines(oldText, newText)) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}

export type DiffRow = DiffLine | { type: 'gap'; hidden: number }

/** Keeps `context` unchanged lines around each change and folds the rest into gap rows. */
export function collapseContext(lines: DiffLine[], context = 3): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.type === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true
  })
  const out: DiffRow[] = []
  let hidden = 0
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (hidden) { out.push({ type: 'gap', hidden }); hidden = 0 }
      out.push(l)
    } else hidden++
  })
  if (hidden) out.push({ type: 'gap', hidden })
  return out
}
