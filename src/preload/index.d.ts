import type { AimuxApi } from '../shared/ipc'
declare global {
  interface Window { aimux: AimuxApi }
}
export {}
