import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 服务端集成测试：http 起真实端口实测 app.callback()，无需 DOM
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
