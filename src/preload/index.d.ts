import type { MymuxApi } from '../shared/ipc'
declare global {
  interface Window { mymux: MymuxApi }
}
export {}
