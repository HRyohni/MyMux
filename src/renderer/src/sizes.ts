// Remembered split ratios, keyed by the id of the split (or pane) whose panels were resized.

type Sizes = Record<string, number>

const KEY = 'mymux.sizes'
/** Entries kept at most; ids of closed panes are never reused, so old ones are dropped by age. */
const LIMIT = 200

let cache: Record<string, Sizes> = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Sizes> } catch { return {} }
})()
let timer: ReturnType<typeof setTimeout> | undefined

export const savedSizes = (id: string): Sizes | undefined => cache[id]

export function saveSizes(id: string, sizes: Sizes) {
  const { [id]: _old, ...rest } = cache
  // Re-inserting moves the id to the end, so the oldest untouched ids are the first to go.
  const entries = [...Object.entries(rest), [id, sizes] as const].slice(-LIMIT)
  cache = Object.fromEntries(entries)
  clearTimeout(timer)
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(cache)) } catch { /* storage unavailable */ }
  }, 400)
}
