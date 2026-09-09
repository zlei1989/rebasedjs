import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
    // Windows msys2 并发缺陷：15 worker 文件级并行时 git 子进程压力骤增，
    // 交互式 rebase 等用例 30s 超时、临时目录竞态频发（backlog 已知 flake）；
    // 文件级串行压降 git 并发，实测更稳。
    fileParallelism: false,
  },
});
