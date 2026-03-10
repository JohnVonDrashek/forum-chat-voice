import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import noUnsanitized from 'eslint-plugin-no-unsanitized'

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/.vercel/',
      '**/target/',
      '.claude/',
      'example-forum-instances-and-shared-forum-server/forum-a/',
      'example-forum-instances-and-shared-forum-server/forum-b/',
      'website/',
      'scripts/',
      'published-npm-packages/protocol/src/**/*.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'forumline-identity-and-federation-web/vite.config.ts',
            'vitest.workspace.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // Block innerHTML/outerHTML assignments with dynamic content (XSS vectors)
      'no-unsanitized/property': 'error',
      // Block document.write, insertAdjacentHTML with dynamic content
      'no-unsanitized/method': 'error',
    },
  },
  // Disable type-checked rules for JS/MJS files not covered by tsconfig
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
)
