import { createContext, useContext } from 'react'
import { useStore } from '../store'

/** The session a piece of chat UI belongs to; null inside nested or detached views. */
export const SessionContext = createContext<{ sessionId: string; cwd: string } | null>(null)

/** Opens a file in the session's browser panel. Returns null where no session is in scope. */
export function useOpenFile(): ((path: string) => void) | null {
  const ctx = useContext(SessionContext)
  if (!ctx) return null
  return (path) => {
    useStore.getState().setBrowserOpen(ctx.sessionId, true)
    void window.mymux.browser.openFile(ctx.sessionId, path)
  }
}
