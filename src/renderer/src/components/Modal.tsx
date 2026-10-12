import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'

/**
 * Centered dialog. While it is open the embedded browser views are hidden, because they are
 * native views drawn above the DOM and would otherwise cover it.
 */
export default function Modal({ title, onClose, children, width = 'max-w-xl' }: {
  title: string; onClose(): void; children: React.ReactNode; width?: string
}) {
  useEffect(() => {
    const { pushOverlay, popOverlay } = useStore.getState()
    pushOverlay()
    return popOverlay
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="no-drag fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${width} max-h-full flex flex-col rounded-xl border border-border-strong bg-bg-elev shadow-2xl fade-in`}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 h-11 border-b border-border">
          <span className="text-[13.5px] font-semibold flex-1 truncate">{title}</span>
          <button onClick={onClose} title="Zatvori (Esc)" className="w-7 h-7 rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
