import { useEffect, useState } from 'react'

/** Width of the in-app window controls (3 buttons x 46px), see WindowControls.tsx. */
export const WINDOW_CONTROLS_WIDTH = 138

/**
 * How many pixels of the element's right side sit under the native window controls
 * (minimize / maximize / close). Those pixels must not be a drag region and must not hold buttons.
 */
export function useWindowControlsInset(ref: React.RefObject<HTMLElement | null>) {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const compute = () => {
      const r = el.getBoundingClientRect()
      const controlsStart = window.innerWidth - WINDOW_CONTROLS_WIDTH
      setInset(r.top < 40 ? Math.max(0, Math.round(r.right - controlsStart)) : 0)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    window.addEventListener('resize', compute)
    const timer = setInterval(compute, 500) // position-only changes (split drag) do not fire ResizeObserver
    return () => {
      ro.disconnect()
      clearInterval(timer)
      window.removeEventListener('resize', compute)
    }
  }, [ref])
  return inset
}
