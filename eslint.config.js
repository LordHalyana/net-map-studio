import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
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
  // Type-aware rules on package sources only; tests, e2e and config files stay
  // on the untyped preset so the project service doesn't pay for them.
  {
    files: ['apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx', 'packages/*/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Fastify route handlers are declared async uniformly even when the body
    // is synchronous — that's the framework's idiomatic shape, and forcing
    // sync signatures would churn every route for no safety gain. The rules
    // that catch real async bugs (no-floating-promises, no-misused-promises)
    // stay on.
    files: ['apps/server/src/app.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
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
