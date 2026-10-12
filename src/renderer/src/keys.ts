// Keyboard shortcut actions and combo matching. Pure, so it is unit-testable.

export type ActionId =
  | 'newGroup' | 'nextGroup' | 'prevGroup' | 'closeGroup' | 'toggleSidebar' | 'newChat'
  | 'splitRight' | 'splitDown' | 'closePane' | 'toggleBrowser' | 'find' | 'settings' | 'overview'

export const ACTIONS: { id: ActionId; label: string; combo: string }[] = [
  { id: 'newChat', label: 'Novi razgovor u fokusiranom panelu', combo: 'Ctrl+N' },
  { id: 'splitRight', label: 'Podijeli panel desno', combo: 'Ctrl+\\' },
  { id: 'splitDown', label: 'Podijeli panel dolje', combo: 'Ctrl+Shift+\\' },
  { id: 'closePane', label: 'Zatvori fokusirani panel', combo: 'Ctrl+W' },
  { id: 'toggleBrowser', label: 'Prikaži/sakrij browser panel', combo: 'Ctrl+B' },
  { id: 'find', label: 'Pretraži razgovor', combo: 'Ctrl+F' },
  { id: 'newGroup', label: 'Nova grupa', combo: 'Ctrl+T' },
  { id: 'nextGroup', label: 'Sljedeća grupa', combo: 'Ctrl+Tab' },
  { id: 'prevGroup', label: 'Prethodna grupa', combo: 'Ctrl+Shift+Tab' },
  { id: 'closeGroup', label: 'Zatvori grupu', combo: 'Ctrl+Shift+W' },
  { id: 'toggleSidebar', label: 'Sakrij/prikaži bočnu traku', combo: 'Ctrl+Shift+B' },
  { id: 'overview', label: 'Pregled svih razgovora', combo: 'Ctrl+Shift+O' },
  { id: 'settings', label: 'Postavke', combo: 'Ctrl+,' },
]

export const DEFAULT_KEYS = Object.fromEntries(ACTIONS.map((a) => [a.id, a.combo])) as Record<ActionId, string>

/** Characters a shifted key produces, mapped back to the key itself so "Ctrl+Shift+\" stays stable. */
const UNSHIFT: Record<string, string> = { '|': '\\', '<': ',', '>': '.', '?': '/', ':': ';', '"': "'", '{': '[', '}': ']', '_': '-', '+': '=' }

export interface KeyLike { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }

/** "Ctrl+Shift+W" for a keydown event, or '' while only modifier keys are held. */
export function comboOf(e: KeyLike): string {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return ''
  let key = e.key
  if (key === ' ') key = 'Space'
  else if (key.length === 1) key = (e.shiftKey && UNSHIFT[key]) || key.toUpperCase()
  const mods = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean)
  return [...mods, key].join('+')
}

/** The action bound to a combo. Combos without Ctrl or Alt are never shortcuts, they are typing. */
export function actionFor(combo: string, keys: Record<ActionId, string>): ActionId | null {
  if (!combo || !/^(Ctrl|Alt)\+/.test(combo)) return null
  for (const a of ACTIONS) if ((keys[a.id] ?? a.combo) === combo) return a.id
  return null
}
