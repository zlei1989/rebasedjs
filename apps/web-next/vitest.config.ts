import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 路由测试直接调 route 函数（Request/Response 为 Node 18+ 全局），无需 DOM
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
