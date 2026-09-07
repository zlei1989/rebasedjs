/**
 * Playwright e2e 配置。
 * webServer：经 workspace 启动 web-next dev（PORT=3030），配置目录隔离到本次运行专属 tmp
 * （REBASED_CONFIG_DIR——api 层配置存储根，见 packages/server/api/src/lib/config-store.ts），
 * 开发服务器冷启动慢（Windows + Next dev 首请求编译），取 120s。
 * 浏览器通道：见 task-1-report.md（预检发现本地 ms-playwright 缓存已含 chromium-1234 /
 * chromium_headless_shell-1234，与 @playwright/test@1.62.1 所需修订号一致 → 用官方 chromium，
 * 无需降级 channel: 'msedge'）。
 */
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 本次运行专属配置根（app 的 recent.json 等写入此处，避免污染开发者真实配置） */
const configDir = mkdtempSync(join(tmpdir(), 'rebased-e2e-config-'));

export default defineConfig({
  testDir: './tests',
  // Windows + Next dev 首路由编译可能数十秒：测试级超时放宽到 90s；断言超时 30s
  // （冷启动时 SWR/首路由编译可能超过 15s——复审 Fix round 1 上调）
  timeout: 90_000,
  expect: { timeout: 30_000 },
  // 单一 dev server + 串行确定性：本包测试串行跑（后续任务引入多 spec 时按需放开）
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3030',
    headless: true,
    // dev server 冷启动首请求编译耗时可能超过默认 30s
    navigationTimeout: 120_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm --filter @rebased/web-next dev',
    url: 'http://localhost:3030',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      REBASED_CONFIG_DIR: configDir,
      // PORT 有意不传：web-next dev 脚本固定 `-p 3030`（端口已在命令行声明，避免重复声明的误导）
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
