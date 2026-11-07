// Flat ESLint config for the SENTRAVYN backend. Uses only typescript-eslint
// (a direct devDependency) so it resolves cleanly under pnpm.
import tseslint from 'typescript-eslint';

export default [
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // Strict TS (CLAUDE.md 11): `any` is forbidden; unused vars are errors.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'prisma/'],
  },
];
