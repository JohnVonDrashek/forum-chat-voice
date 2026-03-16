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
      'services/website/',
      '.github/scripts/',
      'packages/protocol/src/**/*.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'vitest.workspace.ts',
            'packages/protocol/src/validation.test.ts',
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
      // Force @forumline/* workspace imports — no sneaking around with relative paths
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/packages/*', '**/packages/**'],
          message: 'Import from @forumline/* instead of using relative paths into packages/.',
        }],
      }],
    },
  },
  // Disable type-checked rules for JS/MJS files not covered by tsconfig
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Forumline-web uses innerHTML for template rendering with escaped/static data
  {
    files: ['services/forumline-web/src/**/*.js'],
    rules: {
      'no-unsanitized/property': 'warn',
      'no-unsanitized/method': 'warn',
    },
  },
)
