import tseslint from 'typescript-eslint'
import globals from 'globals'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.js', '*.config.ts', 'turbo.json', '*.d.ts', '*.js', '*.mjs', '.agents/**', '.github/**', 'benchmarks/**', 'scripts/**', 'skills/**', 'docs/**', 'examples/**', '**/dist/**', '**/tests/**', '**/*.test.ts', '**/*.spec.ts', '**/vitest.config.ts', '**/*.e2e.test.ts', '**/*.config.ts', '*.md', '*.json', '*.yml', '*.yaml'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
      ecmaVersion: 2023,
      sourceType: 'module',
      parser: await import('@typescript-eslint/parser').then(m => m.default),
      parserOptions: {
        project: ['./tsconfig.json', './packages/*/tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': (await import('typescript-eslint')).plugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)