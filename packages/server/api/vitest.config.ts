import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 60s：git CLI 夹具测试在并行压力下（24 个文件 × 每用例多次 git 进程）单用例可冲 30s
  // 看门狗；远程装置类用例另有 120s 的逐用例覆写（remote.test.ts RIG_TIMEOUT 同型）
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60000,
    // 夹具模板 beforeAll 钩子串行执行数十次 git spawn（本机单次 ~330ms），放宽钩子超时
    hookTimeout: 120000,
    // 上限 8 worker：默认 nCPU 并发 × 每文件数十 git spawn 会互相拖慢单次 spawn 并诱发 60s 超时
    //（本机实测单次 git spawn ~330ms；曾出现 forks worker 终止超时）
    maxWorkers: 8,
    // 提交身份环境变量注入（建仓模板化后夹具仍可提交；见 src/testing/setup.ts）
    setupFiles: ['src/testing/setup.ts'],
  },
});
