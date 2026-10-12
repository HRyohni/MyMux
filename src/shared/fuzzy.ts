/**
 * Score of `query` as a subsequence of `path` (higher is better), or -1 when it does not match.
 * Matches in the file name and consecutive matches count for more.
 */
export function fuzzyScore(path: string, query: string): number {
  const q = query.toLowerCase()
  if (!q) return 0
  const p = path.toLowerCase()
  const nameStart = p.lastIndexOf('/') + 1
  const direct = p.indexOf(q, nameStart)
  if (direct >= 0) return 1000 - (direct - nameStart) * 2 - (p.length - nameStart)
  let score = 0
  let pi = 0
  let streak = 0
  for (const ch of q) {
    const found = p.indexOf(ch, pi)
    if (found < 0) return -1
    streak = found === pi ? streak + 1 : 0
    score += 1 + streak * 2 + (found >= nameStart ? 2 : 0)
    pi = found + 1
  }
  return score - p.length * 0.01
}

export function rankFiles(files: string[], query: string, limit: number): string[] {
  const q = query.replace(/\\/g, '/')
  if (!q) return files.slice(0, limit)
  const scored: { f: string; s: number }[] = []
  for (const f of files) {
    const s = fuzzyScore(f, q)
    if (s >= 0) scored.push({ f, s })
  }
  scored.sort((a, b) => b.s - a.s || a.f.length - b.f.length)
  return scored.slice(0, limit).map((x) => x.f)
}
