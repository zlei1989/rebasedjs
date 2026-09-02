/** Vite SPA：dev 下代理 /api → Koa(3031)；页面与 API 同源语义 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3031',
    },
  },
  build: { outDir: 'public' },
});
