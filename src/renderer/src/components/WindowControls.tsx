import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { WINDOW_CONTROLS_WIDTH } from '../hooks'

/** Our own minimize / maximize / close buttons, always on top of every pane. */
export default function WindowControls() {
  const [max, setMax] = useState(false)
  useEffect(() => {
    void window.mymux.window.isMaximized().then(setMax)
    return window.mymux.window.onMaximized(setMax)
  }, [])
  const btn = 'no-drag w-[46px] h-10 flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev2 transition-colors'
  return (
    <div className="fixed top-0 right-0 z-50 flex bg-bg" style={{ width: WINDOW_CONTROLS_WIDTH }}>
      <button className={btn} onClick={() => void window.mymux.window.minimize()} title="Minimiziraj"><Minus size={15} /></button>
      <button className={btn} onClick={() => void window.mymux.window.toggleMaximize()} title={max ? 'Vrati' : 'Maksimiziraj'}>
        {max ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button className={`${btn} hover:bg-danger hover:text-white`} onClick={() => void window.mymux.window.close()} title="Zatvori"><X size={16} /></button>
    </div>
  )
}
