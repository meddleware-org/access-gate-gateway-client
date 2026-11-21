// Vitest settings for the offline unit suite: `npm test`. There is no live suite in this package: the protocol has no chain read, and the gateways run the
// same `vectors.json` against their own implementations.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node, not jsdom: the package has no DOM code (it uses `fetch`, `AbortSignal`, `TextEncoder`, `atob` and `btoa`, which Node provides).
    environment: 'node',
    // Offline unit suite.
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
})
