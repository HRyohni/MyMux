import { defineConfig } from 'vitest/config'

// The tested modules are pure (no DOM, no Electron), so the default node environment is enough.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
