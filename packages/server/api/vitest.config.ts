import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 60s：git CLI 夹具测试在并行压力下（24 个文件 × 每用例多次 git 进程）单用例可冲 30s
  // 看门狗；远程装置类用例另有 120s 的逐用例覆写（remote.test.ts RIG_TIMEOUT 同型）
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60000 },
});
