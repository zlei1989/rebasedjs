import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 服务端集成测试：http 起真实端口实测 app.callback()，无需 DOM
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    // 统一 git 提交身份（GIT_AUTHOR_*/GIT_COMMITTER_*），夹具提交的作者断言依赖于此
    setupFiles: ['src/testing/setup.ts'],
  },
});
