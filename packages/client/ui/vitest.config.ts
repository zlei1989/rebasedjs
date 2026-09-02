import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // graph-layout 纯函数与组件测试并存：jsdom 下纯函数测试同样可跑
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    setupFiles: ['src/testing/setup.ts'],
  },
});
