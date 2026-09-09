import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    // 夹具模板 beforeAll 钩子串行执行数十次 git spawn（本机单次 ~330ms），放宽钩子超时
    hookTimeout: 120000,
    // Windows msys2 并发缺陷（历史记录）：15 worker 文件级并行时 git 子进程压力骤增，
    // 交互式 rebase 等用例 30s 超时、临时目录竞态频发（backlog 已知 flake）。
    // 提速实验：P0 夹具模板化把 git spawn 数砍掉大半后，尝试受限文件级并行（maxWorkers 4）；
    // 若回归 flake 再回退 fileParallelism: false。
    maxWorkers: 4,
    // 提交身份环境变量注入（建仓模板化后夹具仍可提交；见 src/testing/setup.ts）
    setupFiles: ['src/testing/setup.ts'],
  },
});
