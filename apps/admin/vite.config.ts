import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const srcDir = new URL('./src/', import.meta.url).pathname;

/**
 * Админ-панель AULA (SPA). В разработке /api проксируется на API (http://localhost:3000),
 * поэтому refresh-cookie (path=/api/v1/admin/auth, SameSite=Strict) работает на том же origin.
 * В продакшене админка и API должны обслуживаться с одного домена (reverse proxy /api → API)
 * или VITE_API_URL должен указывать на API того же сайта.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.VITE_DEV_API_PROXY || 'http://localhost:3000';
  return {
    plugins: [react()],
    resolve: {
      alias: [{ find: /^@\//, replacement: srcDir }],
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
      },
    },
    preview: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: false },
      },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            antd: ['antd', '@ant-design/icons'],
            query: ['@tanstack/react-query'],
            i18n: ['i18next', 'react-i18next', 'dayjs'],
          },
        },
      },
    },
  };
});
