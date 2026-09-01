import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // 全局 setup：统一补齐 jsdom 缺失 API 并消除 getComputedStyle 伪元素警告（node 环境自动跳过）
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      // 覆盖数据层 + WS 服务端全部逻辑模块（config/session-manager/gateway 等均计入）；
      // env.ts 等无测试文件的模块不在 include 内，避免拉低整体覆盖率
      include: [
        "src/lib/db.ts",
        "src/lib/errors.ts",
        "src/lib/migrations.ts",
        "src/lib/repositories/**",
        "src/server/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
