// ESLint витрины: правила Next.js (core-web-vitals + typescript) через FlatCompat.
// @eslint/eslintrc — зависимость самого eslint; берём её оттуда, чтобы не добавлять пакет в apps/web.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const requireFromEslint = createRequire(require.resolve('eslint/package.json'));
const { FlatCompat } = requireFromEslint('@eslint/eslintrc');

const compat = new FlatCompat({ baseDirectory: here });

const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**', 'coverage/**'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];

export default config;
