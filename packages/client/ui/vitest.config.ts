import { defineConfig } from 'vitest/config';

export default defineConfig({
  // monaco-editor 的 package.json 只有 `module` 字段（无 main/exports），
  // 解析器默认的 mainFields 顺序会解析不到入口；测试里 import monaco-editor 会报
  // 「Failed to resolve entry for package」——显式把 module 排在最前
  resolve: { mainFields: ['module', 'main'] },
  test: {
    // graph-layout 纯函数与组件测试并存：jsdom 下纯函数测试同样可跑
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    setupFiles: ['src/testing/setup.ts'],
  },
});
