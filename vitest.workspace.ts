import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name: 'protocol',
      root: './published-npm-packages/protocol',
      include: ['src/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'web-app',
      root: './forumline-identity-and-federation-web',
      include: ['src/**/*.test.ts'],
    },
    resolve: {
      alias: {
        '@johnvondrashek/forumline-protocol': './published-npm-packages/protocol/src/index.ts',
      },
    },
  },
])
