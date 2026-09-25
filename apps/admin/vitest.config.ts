import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const srcDir = new URL('./src/', import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: srcDir }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Рендер-тесты antd при параллельном прогоне всего набора бывают медленнее 5 с по умолчанию.
    testTimeout: 20_000,
  },
});
