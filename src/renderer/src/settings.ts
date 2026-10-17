import { create } from 'zustand'
import type { PermissionMode, EffortLevel, McpServerSpec } from '../../shared/ipc'
import { DEFAULT_KEYS, type ActionId } from './keys'

/** A reusable prompt offered from the composer menu. */
export interface PromptTemplate { id: string; name: string; text: string }

export interface Settings {
  theme: 'dark' | 'light'
  /** Zoom factor of the whole UI; this is how the font size is changed. */
  zoom: number
  sound: boolean
  defaultModel: string
  defaultMode: PermissionMode
  defaultEffort: EffortLevel | ''
  keys: Record<ActionId, string>
  prompts: PromptTemplate[]
  /** MCP servers added in the app; every new session gets them on top of Claude Code's own. */
  mcpServers: Record<string, McpServerSpec>
}

const KEY = 'mymux.settings'

const DEFAULTS: Settings = {
  theme: 'dark', zoom: 1, sound: true, defaultModel: '', defaultMode: 'default', defaultEffort: '', keys: DEFAULT_KEYS,
  prompts: [], mcpServers: {},
}

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null
    // The sound toggle used to be stored on its own.
    const legacySound = localStorage.getItem('mymux.sound')
    return {
      ...DEFAULTS,
      ...(legacySound !== null ? { sound: legacySound !== '0' } : {}),
      ...saved,
      keys: { ...DEFAULT_KEYS, ...saved?.keys },
    }
  } catch { return DEFAULTS }
}

interface SettingsStore extends Settings {
  set(patch: Partial<Settings>): void
  setKey(action: ActionId, combo: string): void
  resetKeys(): void
}

export const useSettings = create<SettingsStore>((set) => ({
  ...load(),
  set: (patch) => set(patch),
  setKey: (action, combo) => set((s) => ({ keys: { ...s.keys, [action]: combo } })),
  resetKeys: () => set({ keys: DEFAULT_KEYS }),
}))

let initialized = false

/** Applies theme and zoom to the document and keeps the settings saved. */
export function initSettings() {
  if (initialized) return
  initialized = true
  const apply = (s: Settings) => {
    document.documentElement.dataset.theme = s.theme
    void window.mymux.window.setZoom(s.zoom)
  }
  apply(useSettings.getState())
  useSettings.subscribe((s) => {
    apply(s)
    const { theme, zoom, sound, defaultModel, defaultMode, defaultEffort, keys, prompts, mcpServers } = s
    try {
      localStorage.setItem(KEY, JSON.stringify({ theme, zoom, sound, defaultModel, defaultMode, defaultEffort, keys, prompts, mcpServers }))
    } catch { /* storage unavailable */ }
  })
}
