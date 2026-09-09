import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 路由测试直接调 route 函数（Request/Response 为 Node 18+ 全局），无需 DOM
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 每个 worker 注入 git 提交身份环境变量（GIT_AUTHOR_*/GIT_COMMITTER_*）：
    // 拆分后的路由测试夹具不再写 git config user.*，见 src/testing/setup.ts
    setupFiles: ['./src/testing/setup.ts'],
    testTimeout: 30000,
  },
});
