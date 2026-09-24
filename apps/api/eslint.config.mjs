// ESLint: качество кода + границы модулей (условие приёмки: нарушение валит сборку).
// Правило границ: файл модуля X может импортировать shared/*, свой модуль целиком
// и только публичный контракт (modules/Y/public) других модулей.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, 'src', 'modules');
const MODULES = readdirSync(modulesDir).filter((name) => statSync(join(modulesDir, name)).isDirectory());

const moduleRules = MODULES.flatMap((m) => [
  {
    from: [['module', { module: m }]],
    allow: ['shared', 'module-public', ['module', { module: m }], ['module-public', { module: m }]],
  },
  {
    from: [['module-public', { module: m }]],
    allow: ['shared', 'module-public', ['module', { module: m }]],
  },
]);

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'storage/**', 'scripts/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { node: { extensions: ['.ts', '.js'] } },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'shared', pattern: 'src/shared/**', mode: 'full' },
        { type: 'module-public', pattern: 'src/modules/*/public/**', mode: 'full', capture: ['module'] },
        { type: 'module', pattern: 'src/modules/*/**', mode: 'full', capture: ['module'] },
        { type: 'app', pattern: 'src/**', mode: 'full' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            'Нарушение границ модулей: импорт внутренностей другого модуля запрещён. Используйте его публичный контракт (modules/<m>/public) или события.',
          rules: [
            { from: ['shared'], allow: ['shared'] },
            ...moduleRules,
            { from: ['app'], allow: ['shared', 'module', 'module-public', 'app'] },
          ],
        },
      ],
      'boundaries/no-unknown': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/**/*.spec.ts', 'src/cli/**/*.ts', 'test/**/*.ts'],
    rules: { 'no-console': 'off', 'boundaries/element-types': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
);
