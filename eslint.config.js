import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Working agreement: no `as` outside tests (shoehorn there instead).
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/e2e/**', '**/*.config.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
    },
  },
  prettier,
);
