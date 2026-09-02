import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // hooks 测试用 mock fetch/可控流，无需 DOM：react-test-renderer 在 node 环境渲染
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    setupFiles: ['src/testing/setup.ts'],
  },
});
