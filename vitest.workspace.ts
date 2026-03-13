import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'protocol',
      root: './packages/protocol',
      include: ['src/**/*.test.ts'],
    },
  },
])
