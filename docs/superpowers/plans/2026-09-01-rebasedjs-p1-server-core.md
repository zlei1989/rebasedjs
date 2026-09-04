# Rebased.js 服务端核心（骨架 + contracts + core + api P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `rebasedjs` 工作区落地 monorepo 骨架与服务端核心三层（contracts → core → api），产出可直接测试的 P1 功能服务层（repo/status/log/diff/settings）。

**Architecture:** 本计划实现 spec §7 步骤 1–4。包边界即分层边界：`contracts`（跨端类型/错误/SSE 契约，被所有人依赖）→ `core`（git CLI 引擎，零依赖）→ `api`（功能服务层，一个功能一个文件，只依赖 core + contracts）。eslint `no-restricted-imports` 硬约束服务层不 import 任何框架。apps 与 client 包在本计划中只建包骨架（package.json 占位），功能实现在计划 2。

**Tech Stack:** pnpm workspace、TypeScript 5（strict、Bundler resolution）、vitest、eslint 9 flat config（+ `eslint-plugin-import-x`/`unused-imports`/`@stylistic`，均已在根 devDependencies）、zod（仅 contracts）、jiti（eslint 加载 TS 配置）。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`（本计划实现其 §7 步骤 1–4；§4.1 core、§4.2 api P1 行、§4.3 contracts P1 部分、§6 测试与质量）。

## Global Constraints

- 包名 scope `@rebased/*`：`@rebased/core`、`@rebased/api`、`@rebased/contracts`、`@rebased/ui`、`@rebased/client`、`@rebased/web-next`、`@rebased/web-koa`。
- `core`、`api` 禁止 import `next`/`koa`/`react`/`react-dom`（eslint `no-restricted-imports`，违反即失败）。
- 功能服务层**一个功能一个文件**（api/src/ 下平铺），功能文件之间仅通过 `index.ts` 公共出口互调；跨功能共享的持久化基础设施放 `api/src/lib/`（不进公共出口）。
- core 测试用**真实 git CLI + 临时仓库 fixture**，不 mock git；纯解析函数补单测。
- 错误形状 `{ error: { code, message, context? } }`；`ServiceError { code, message, context?, cause? }`；HTTP 映射由 contracts 的 `httpStatusFor(code)` 提供。
- SSE 事件格式 `{ type, payload }`（本计划只实现序列化函数，路由挂载在计划 2）。
- 注释风格：TS/TSX 用 JSDoc，中文，简洁，先说"做什么"再说"怎么做"。
- 质量门顺序：`pnpm typecheck` → `pnpm format` → `pnpm test`，全绿才能进入审查。
- 说明：类型检查采用**源码直引**（各包 `types` 指向 `src/index.ts` + Bundler resolution + `pnpm typecheck` 逐包 `tsc --noEmit`），等价保证 spec 要求的全链类型检查；不引入 project references（与 Bundler resolution 冲突）。

---

## 文件结构总览

```text
rebasedjs/
├── package.json                 # 更新 scripts（-r typecheck/format/test 保持）
├── pnpm-workspace.yaml          # 改为 apps/* + packages/server/* + packages/client/*
├── tsconfig.base.json           # 新增：共享编译选项
├── eslint.shared.ts             # 重写：baseConfig + withBoundary(pkg) 边界规则工厂
├── packages/
│   ├── server/
│   │   ├── contracts/
│   │   │   ├── package.json     # @rebased/contracts，deps: zod
│   │   │   ├── tsconfig.json / vitest.config.ts / eslint.config.ts
│   │   │   └── src/{index,errors,sse,domain,endpoints}.ts (+ 各自 .test.ts)
│   │   ├── core/
│   │   │   ├── package.json     # @rebased/core，零运行时依赖
│   │   │   ├── tsconfig.json / vitest.config.ts / eslint.config.ts
│   │   │   ├── src/{index,exec,repo,status,log,diff}.ts (+ 各自 .test.ts)
│   │   │   └── src/testing/tmp-repo.ts   # 测试夹具（不进公共出口）
│   │   └── api/
│   │       ├── package.json     # @rebased/api，deps: core/contracts workspace:*
│   │       ├── tsconfig.json / vitest.config.ts / eslint.config.ts
│   │       ├── src/lib/config-store.ts   # 配置持久化（内部基础设施）
│   │       └── src/{index,errors,settings,repo,status,log,diff}.ts (+ 测试)
│   └── client/{ui,client}/      # 仅 package.json + tsconfig + eslint 占位（计划 2 填 src）
└── apps/{web-next,web-koa}/     # 仅 package.json + tsconfig + eslint 占位（计划 2 填内容）
```

删除：`packages/web` 整目录、`packages/api` 内的旧 tiegongji 残留配置文件（已改名过来的 README/eslint.config.ts/package.json/tsconfig.json/vitest.config.ts）。

---

### Task 1: monorepo 骨架与边界规则

**Files:**
- Delete: `packages/web`、`packages/api/{README.md,eslint.config.ts,package.json,tsconfig.json,vitest.config.ts}`
- Create: `tsconfig.base.json`、重写 `eslint.shared.ts`、更新 `pnpm-workspace.yaml`、更新根 `package.json`
- Create: 7 个包的 `package.json` + `tsconfig.json` + `eslint.config.ts`（core/api/contracts 另加 `vitest.config.ts`）

**Interfaces:**
- Consumes: 无。
- Produces: 包名与目录（后续任务的文件都落在这些包内）；`withBoundary(pkg)`、`baseConfig`（eslint.shared.ts，供各包 eslint.config.ts 引用）。

- [ ] **Step 1: 更新 pnpm-workspace.yaml**

```yaml
packages:
  - apps/*
  - packages/server/*
  - packages/client/*
```

- [ ] **Step 2: 写 tsconfig.base.json**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: 重写 eslint.shared.ts（边界规则核心）**

```ts
/**
 * 共享 ESLint flat 配置 + 分层边界规则工厂。
 * 边界即架构：api/core 禁框架；ui 禁数据层；client 禁 apps；apps 间互禁。
 */
import type { Linter } from 'eslint';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';

export type PackageName = 'core' | 'api' | 'contracts' | 'ui' | 'client' | 'web-next' | 'web-koa';

/** 各包禁止 import 的模块（paths 传给 no-restricted-imports） */
const FORBIDDEN: Record<PackageName, string[]> = {
  core: ['next', 'next/*', 'koa', 'react', 'react-dom'],
  api: ['next', 'next/*', 'koa', 'react', 'react-dom'],
  contracts: [],
  ui: ['@rebased/client', '@rebased/api', '@rebased/web-next', '@rebased/web-koa', 'next/navigation'],
  client: ['@rebased/web-next', '@rebased/web-koa'],
  'web-next': ['@rebased/web-koa'],
  'web-koa': ['@rebased/web-next'],
};

export const baseConfig: Linter.Config[] = [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/public/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@stylistic': stylistic, 'import-x': importX, 'unused-imports': unusedImports },
    rules: {
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/indent': ['error', 2],
      'unused-imports/no-unused-imports': 'error',
      'import-x/no-duplicates': 'error',
    },
  },
];

/** 按包名生成带边界约束的配置（与 baseConfig 合并使用） */
export function withBoundary(pkg: PackageName): Linter.Config[] {
  const paths = FORBIDDEN[pkg];
  if (paths.length === 0) return baseConfig;
  return [
    ...baseConfig,
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: paths.map((name) => ({
              name,
              message: `[分层边界] ${pkg} 禁止 import ${name}（见 docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md §3.3）`,
            })),
          },
        ],
      },
    },
  ];
}
```

- [ ] **Step 4: 更新根 package.json scripts 并加 jiti**

```json
{
  "name": "rebased.js",
  "displayName": "可视化 GIT 工具",
  "private": true,
  "packageManager": "pnpm@10.26.2",
  "scripts": {
    "preinstall": "node -e \"if(!/pnpm/i.test(process.env.npm_config_user_agent||'')){console.error('[禁止] 本项目仅允许使用 pnpm 安装依赖，请运行: corepack enable && pnpm install');process.exit(1)}\"",
    "build": "pnpm -r build",
    "dev": "pnpm -r dev",
    "format": "pnpm -r format",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "@stylistic/eslint-plugin": "^4.4.1",
    "@types/node": "^20.19.43",
    "eslint": "^9.39.5",
    "eslint-plugin-import-x": "^4.17.1",
    "eslint-plugin-unused-imports": "^4.4.1",
    "jiti": "^2.7.0"
  }
}
```

- [ ] **Step 5: 写 7 个包的 package.json**

core（`packages/server/core/package.json`）：

```json
{
  "name": "@rebased/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "format": "eslint . --fix",
    "test": "vitest run"
  },
  "devDependencies": {
    "eslint": "^9",
    "typescript": "^5",
    "vitest": "^4"
  }
}
```

api（`packages/server/api/package.json`）——scripts 同上，另加：

```json
  "dependencies": {
    "@rebased/contracts": "workspace:*",
    "@rebased/core": "workspace:*"
  },
```

contracts（`packages/server/contracts/package.json`）——scripts 同上，另加：

```json
  "dependencies": {
    "zod": "^3.25.28"
  },
```

ui/client/web-next/web-koa 四个占位包（`packages/client/ui/package.json` 等，name 分别为 `@rebased/ui`、`@rebased/client`、`@rebased/web-next`、`@rebased/web-koa`，scripts 同 core，无 dependencies；web-next/web-koa 的 `package.json` 不含 `"type": "module"`）。

- [ ] **Step 6: 写各包 tsconfig.json / eslint.config.ts / vitest.config.ts**

`packages/server/core/tsconfig.json`（其余包同构，仅 extends 相对路径不同）：

```json
{ "extends": "../../../tsconfig.base.json", "include": ["src"] }
```

`packages/server/core/eslint.config.ts`：

```ts
/** core 包 ESLint：共享规则 + 服务端禁框架边界 */
import { withBoundary } from '../../../eslint.shared.ts';

export default withBoundary('core');
```

（api 用 `withBoundary('api')`，contracts 用 `withBoundary('contracts')`，ui/client/web-next/web-koa 同理；apps 与 client 包的相对路径为 `../../eslint.shared.ts`。）

`packages/server/core/vitest.config.ts`（api/contracts 同构）：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
```

- [ ] **Step 7: 删除旧遗留并提交清理**

```powershell
Remove-Item packages\web -Recurse -Force
Remove-Item packages\api\README.md, packages\api\eslint.config.ts, packages\api\package.json, packages\api\tsconfig.json, packages\api\vitest.config.ts -Force
git status --short   # 确认其余变更仅为旧 tiegongji 文件删除（.claude、docs/superpowers/plans/2026-08-*、README.md、DESIGN.md、CLAUDE.md）
git add -A .claude docs README.md DESIGN.md CLAUDE.md packages
git commit -m "chore: 清理旧 tiegongji 遗留并搭建 7 包 monorepo 骨架"
```

- [ ] **Step 8: 安装并验证工具链全绿**

```powershell
pnpm install
pnpm typecheck   # 预期：各包 tsc 无错（尚无 src 则跳过）
pnpm format      # 预期：eslint 无错
pnpm test        # 预期：vitest --passWithNoTests 无错
```

预期：三个命令均退出码 0。

---

### Task 2: contracts —— 错误模型、HTTP 映射与 SSE 序列化

**Files:**
- Create: `packages/server/contracts/src/errors.ts`、`sse.ts`
- Test: `packages/server/contracts/src/errors.test.ts`、`sse.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `ErrorCode`、`ServiceError`（`constructor(code, message, options?)`、属性 `code/message/context/cause`）、`httpStatusFor(code): number`、`SseEvent`、`serializeSseEvent(event): string`。

- [ ] **Step 1: 写失败测试 `errors.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ServiceError, httpStatusFor } from './errors';

describe('ServiceError', () => {
  it('携带 code 与 context，message 可读', () => {
    const e = new ServiceError('NOT_A_GIT_REPO', '不是 git 仓库', { context: { path: '/tmp/x' } });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('NOT_A_GIT_REPO');
    expect(e.context).toEqual({ path: '/tmp/x' });
    expect(e.message).toBe('不是 git 仓库');
  });

  it('httpStatusFor 覆盖全部错误码', () => {
    expect(httpStatusFor('REPO_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('GIT_ERROR')).toBe(500);
    expect(httpStatusFor('CANCELLED')).toBe(499);
    for (const code of ERROR_CODES) expect(typeof httpStatusFor(code)).toBe('number');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/contracts test -- errors.test.ts`
Expected: FAIL（找不到模块 `./errors`）。

- [ ] **Step 3: 实现 `errors.ts`**

```ts
/**
 * 统一错误模型：错误码 + 可直接展示的中文 message + 可选上下文。
 * 框架层按 httpStatusFor 把 code 映射为 HTTP 状态码。
 */
export const ERROR_CODES = [
  'REPO_NOT_FOUND',
  'NOT_A_GIT_REPO',
  'INVALID_REF',
  'INVALID_QUERY',
  'CONFLICT',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'HOOK_FAILED',
  'STALE_LOCK',
  'OPERATION_IN_PROGRESS',
  'GIT_ERROR',
  'CANCELLED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly context?: unknown;

  constructor(code: ErrorCode, message: string, options?: { context?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'ServiceError';
    this.code = code;
    this.context = options?.context;
  }
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  REPO_NOT_FOUND: 404,
  NOT_A_GIT_REPO: 400,
  INVALID_REF: 400,
  INVALID_QUERY: 400,
  CONFLICT: 409,
  AUTH_FAILED: 401,
  RATE_LIMITED: 429,
  HOOK_FAILED: 422,
  STALE_LOCK: 409,
  OPERATION_IN_PROGRESS: 409,
  GIT_ERROR: 500,
  // 客户端已断开连接，此映射仅作内部兜底，实际无响应可发
  CANCELLED: 499,
};

/** code → HTTP 状态码（两个框架应用共用同一张表） */
export function httpStatusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
```

- [ ] **Step 4: 写 `sse.test.ts` 并先运行确认失败**

```ts
import { describe, expect, it } from 'vitest';
import { serializeSseEvent } from './sse';

describe('serializeSseEvent', () => {
  it('序列化为 data: JSON 帧', () => {
    expect(serializeSseEvent({ type: 'log.line', payload: { hash: 'abc' } }))
      .toBe('data: {"type":"log.line","payload":{"hash":"abc"}}\n\n');
  });
});
```

Run: `pnpm --filter @rebased/contracts test -- sse.test.ts` → Expected: FAIL。

- [ ] **Step 5: 实现 `sse.ts`**

```ts
/**
 * SSE 帧序列化：统一 { type, payload } 事件格式。
 * 服务层产出事件对象，框架层用本函数转 SSE 文本（AsyncIterable → 流）。
 */
export interface SseEvent {
  type: string;
  payload: unknown;
}

export function serializeSseEvent(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
```

- [ ] **Step 6: 运行全部测试并提交**

Run: `pnpm --filter @rebased/contracts test` → Expected: PASS（3 个用例）。

```powershell
git add packages/server/contracts
git commit -m "feat(contracts): 错误模型、HTTP 状态映射与 SSE 序列化"
```

---

### Task 3: contracts —— P1 领域类型与端点 schema

**Files:**
- Create: `packages/server/contracts/src/domain.ts`、`endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: 类型 `RepoInfo`、`ChangeEntry`、`RepoStatus`、`CommitInfo`、`LogPage`、`DiffFile`、`SettingsState`、`LogEvent`、`DiffEvent`；schema `openRepoBodySchema`、`logQuerySchema`、`diffQuerySchema`、`settingsPatchSchema` 及其 `z.infer` 类型。

- [ ] **Step 1: 写失败测试 `endpoints.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { diffQuerySchema, logQuerySchema, openRepoBodySchema, settingsPatchSchema } from './endpoints';

describe('P1 端点 schema', () => {
  it('logQuery 默认 limit=50，接受 author/path/skip', () => {
    expect(logQuerySchema.parse({}).limit).toBe(50);
    expect(logQuerySchema.parse({ limit: 10, skip: 20, author: '张三' }))
      .toEqual({ limit: 10, skip: 20, author: '张三' });
  });

  it('openRepoBody 要求非空 path', () => {
    expect(() => openRepoBodySchema.parse({ path: '' })).toThrow();
  });

  it('diffQuery 默认 unstaged，支持 from/to', () => {
    expect(diffQuerySchema.parse({ file: 'a.txt' })).toEqual({ file: 'a.txt', staged: false });
    expect(diffQuerySchema.parse({ file: 'a.txt', from: 'HEAD~1', to: 'HEAD', staged: true }).staged).toBe(true);
  });

  it('settingsPatch 校验 logInEditor 布尔与 recentRepoIds 数组', () => {
    expect(() => settingsPatchSchema.parse({ logInEditor: 'yes' })).toThrow();
    expect(settingsPatchSchema.parse({ recentRepoIds: ['a', 'b'] })).toEqual({ recentRepoIds: ['a', 'b'] });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/contracts test -- endpoints.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `domain.ts`**

```ts
/** 跨端领域类型：服务层返回、UI 层消费的唯一形状来源。 */

export interface RepoInfo {
  id: string;
  path: string;
  name: string;
  openedAt: string;
}

/** 工作区变更条目（code 为 porcelain v2 XY 码，?? = 未跟踪，!! = 已忽略） */
export interface ChangeEntry {
  path: string;
  code: string;
  renameFrom?: string;
}

export interface RepoStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: ChangeEntry[];
}

/** 提交节点：graph 为原始边列（--graph 前缀），布局算法在计划 2 的 ui/graph-layout 处理 */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  dateIso: string;
  refs: string[];
  message: string;
  graph: string;
}

export interface LogPage {
  commits: CommitInfo[];
  hasMore: boolean;
}

/** 单文件 diff：text 为 unified diff 全文（P1 不做 hunk 结构化） */
export interface DiffFile {
  path: string;
  text: string;
}

export interface SettingsState {
  logInEditor: boolean;
  recentRepoIds: string[];
}

export interface LogEvent {
  type: 'log.line';
  payload: CommitInfo;
}

export interface DiffEvent {
  type: 'diff.chunk';
  payload: { text: string };
}
```

- [ ] **Step 4: 实现 `endpoints.ts`**

```ts
import { z } from 'zod';

export const openRepoBodySchema = z.object({ path: z.string().min(1) });
export type OpenRepoBody = z.infer<typeof openRepoBodySchema>;

export const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  author: z.string().optional(),
  path: z.string().optional(),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

export const diffQuerySchema = z.object({
  file: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  staged: z.coerce.boolean().default(false),
});
export type DiffQuery = z.infer<typeof diffQuerySchema>;

export const settingsPatchSchema = z.object({
  logInEditor: z.boolean().optional(),
  recentRepoIds: z.array(z.string()).optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
```

- [ ] **Step 5: 运行全部测试并提交**

Run: `pnpm --filter @rebased/contracts test` → Expected: PASS（7 个用例，T2 的 3 + T3 的 4）。

```powershell
git add packages/server/contracts
git commit -m "feat(contracts): P1 领域类型与端点 schema"
```

---

### Task 4: core —— git 执行原语（runGit / streamGit）

**Files:**
- Create: `packages/server/core/src/exec.ts`、`src/testing/tmp-repo.ts`
- Test: `packages/server/core/src/exec.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `GitResult { stdout, stderr }`、`GitExitError { args, exitCode, stdout, stderr }`、`runGit(args, opts): Promise<GitResult>`（opts: `{ cwd, signal?, timeoutMs? }`）、`streamGit(args, opts): AsyncIterable<string>`；夹具 `createTmpRepo(): string`、`cleanupTmpRepo(dir): void`。

- [ ] **Step 1: 写夹具 `src/testing/tmp-repo.ts`**

```ts
/** 测试夹具：临时 git 仓库。仅测试使用，不进公共出口。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rebased-core-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test User']);
  return dir;
}

export function cleanupTmpRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: 写失败测试 `exec.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('runGit', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('在真实仓库执行 git 命令', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const r = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo });
    expect(r.stdout.trim()).toBe('true');
    expect(r.stderr).toBe('');
  });

  it('非零退出抛 GitExitError 并携带 stderr', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(runGit(['rev-parse', 'no-such-thing'], { cwd: repo })).rejects.toMatchObject({
      name: 'GitExitError',
      exitCode: 128,
    });
  });

  it('AbortSignal 终止进行中的命令', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    const p = runGit(['log', '--all'], { cwd: repo, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(GitExitError);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- exec.test.ts` → Expected: FAIL（找不到 `./exec`）。

- [ ] **Step 4: 实现 `exec.ts`**

```ts
/**
 * git CLI 执行原语：参数数组防注入、强制无分页、LC_ALL=C、可取消。
 * 平台差异（Windows 杀进程树）集中在本文件处理。
 */
import { spawn } from 'node:child_process';

export interface GitResult {
  stdout: string;
  stderr: string;
}

export class GitExitError extends Error {
  readonly args: string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(args: string[], exitCode: number, stdout: string, stderr: string) {
    const firstLine = stderr.trim().split('\n')[0] ?? '';
    super(`git ${args.join(' ')} 退出码 ${exitCode}${firstLine ? `：${firstLine}` : ''}`);
    this.name = 'GitExitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function buildArgs(args: string[]): string[] {
  return ['--no-pager', '-c', 'core.pager=cat', ...args];
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // Windows 无进程组信号，用 taskkill /T 杀整棵树
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 进程已退出 */
    }
  }
}

/** 执行 git 并收集完整输出（小输出场景） */
export function runGit(args: string[], opts: { cwd: string; signal?: AbortSignal }): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', buildArgs(args), {
      cwd: opts.cwd,
      env: { ...process.env, LC_ALL: 'C' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    opts.signal?.addEventListener('abort', () => killTree(child.pid!), { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new GitExitError(args, code ?? 1, stdout, stderr));
    });
  });
}

/** 流式执行 git（大输出场景：log 图、diff），逐块产出 stdout 文本 */
export async function* streamGit(args: string[], opts: { cwd: string; signal?: AbortSignal }): AsyncIterable<string> {
  const child = spawn('git', buildArgs(args), {
    cwd: opts.cwd,
    env: { ...process.env, LC_ALL: 'C' },
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  opts.signal?.addEventListener('abort', () => killTree(child.pid!), { once: true });

  const exitCode: Promise<number | null> = new Promise((resolve) => child.on('close', resolve));
  child.stdout.setEncoding('utf8');
  for await (const chunk of child.stdout) {
    yield chunk;
  }
  const code = await exitCode;
  if (code !== 0) {
    throw new GitExitError(args, code ?? 1, '', stderr);
  }
}
```

- [ ] **Step 5: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/core test -- exec.test.ts` → Expected: PASS（3 个用例）。

```powershell
git add packages/server/core
git commit -m "feat(core): git 执行原语 runGit/streamGit（参数数组、可取消、杀进程树）"
```

---

### Task 5: core —— 仓库原语（发现/初始化/克隆）

**Files:**
- Create: `packages/server/core/src/repo.ts`
- Test: `packages/server/core/src/repo.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`（`./exec`）。
- Produces: `findRepoRoot(startPath): Promise<string | null>`、`initGitRepo(path): Promise<void>`、`cloneGitRepo(url, targetDir, opts?): Promise<void>`。

- [ ] **Step 1: 写失败测试 `repo.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneGitRepo, findRepoRoot, initGitRepo } from './repo';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('repo 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('findRepoRoot 从子目录向上发现仓库根', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const sub = join(repo, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    expect(await findRepoRoot(sub)).toBe(repo);
  });

  it('findRepoRoot 对非仓库目录返回 null', async () => {
    const plain = join(tmpdir(), `rebased-plain-${Date.now()}`);
    mkdirSync(plain, { recursive: true });
    dirs.push(plain);
    expect(await findRepoRoot(plain)).toBeNull();
  });

  it('initGitRepo 初始化新仓库', async () => {
    const target = join(tmpdir(), `rebased-init-${Date.now()}`);
    dirs.push(target);
    await initGitRepo(target);
    expect(existsSync(join(target, '.git'))).toBe(true);
    expect(await findRepoRoot(target)).toBe(target);
  });

  it('cloneGitRepo 克隆仓库', async () => {
    const src = createTmpRepo();
    dirs.push(src);
    const target = join(tmpdir(), `rebased-clone-${Date.now()}`);
    dirs.push(target);
    await cloneGitRepo(src, target);
    expect(await findRepoRoot(target)).toBe(target);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- repo.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `repo.ts`**

```ts
/** 仓库级原语：发现 .git（含 worktree 的 .git 文件）、初始化、克隆。 */
import { existsSync, lstatSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { runGit } from './exec';

/** 自 startPath 向上找 .git（目录或 worktree 指针文件），找不到返回 null */
export async function findRepoRoot(startPath: string): Promise<string | null> {
  let cur: string = startPath;
  for (;;) {
    const gitPath = join(cur, '.git');
    if (existsSync(gitPath)) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export async function initGitRepo(path: string): Promise<void> {
  await runGit(['init', '-q', path], { cwd: parse(path).root });
}

export async function cloneGitRepo(url: string, targetDir: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
  await runGit(['clone', url, targetDir], { cwd: dirname(targetDir), signal: opts.signal });
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/core test -- repo.test.ts` → Expected: PASS（4 个用例）。

```powershell
git add packages/server/core
git commit -m "feat(core): 仓库发现/初始化/克隆原语"
```

---

### Task 6: core —— status 解析（porcelain v2）

**Files:**
- Create: `packages/server/core/src/status.ts`
- Test: `packages/server/core/src/status.test.ts`

**Interfaces:**
- Consumes: `runGit`（`./exec`）。
- Produces: `CoreStatus { branch, upstream, ahead, behind, entries }`、`CoreChangeEntry { path, code, renameFrom? }`、`getStatus(repoPath): Promise<CoreStatus>`、`parsePorcelainV2(raw): CoreStatus`。

- [ ] **Step 1: 写解析器失败测试 `status.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStatus, parsePorcelainV2 } from './status';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('status 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('parsePorcelainV2 解析分支/上游/领先落后/重命名/未跟踪', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 abc abc file.txt',
      '2 R. N... 100644 100644 100644 abc abc old.txt\u0000new.txt',
      '? untracked.txt',
      '! ignored.log',
    ].join('\0');
    const s = parsePorcelainV2(raw);
    expect(s.branch).toBe('main');
    expect(s.upstream).toBe('origin/main');
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.entries).toHaveLength(4);
    expect(s.entries[1]).toEqual({ path: 'new.txt', code: 'R.', renameFrom: 'old.txt' });
    expect(s.entries[2].code).toBe('??');
  });

  it('getStatus 在真实仓库返回变更条目', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'hello');
    const s = await getStatus(repo);
    expect(s.branch).toBeTruthy();
    expect(s.entries.some((e) => e.path === 'a.txt' && e.code === '??')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- status.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `status.ts`**

```ts
/** status 解析：--porcelain=v2 -z --branch，NUL 分隔，文件名任意字符安全。 */
import { runGit } from './exec';

export interface CoreChangeEntry {
  path: string;
  code: string;
  renameFrom?: string;
}

export interface CoreStatus {
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: CoreChangeEntry[];
}

/** 解析 porcelain v2 记录流（# branch.* 头部 + 1/2/?/! 条目） */
export function parsePorcelainV2(raw: string): CoreStatus {
  const s: CoreStatus = { branch: null, upstream: null, ahead: 0, behind: 0, entries: [] };
  for (const record of raw.split('\0')) {
    if (record.startsWith('# branch.head ')) s.branch = record.slice(14);
    else if (record.startsWith('# branch.upstream ')) s.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const m = record.match(/\+(\d+) -(\d+)/);
      if (m) {
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (record.startsWith('1 ')) {
      const parts = record.split(' ');
      s.entries.push({ path: parts.slice(8).join(' '), code: parts[1] });
    } else if (record.startsWith('2 ')) {
      // 重命名条目：<X><score> <path>\t<origPath>
      const parts = record.slice(2).split(' ');
      const tail = parts.slice(8).join(' ');
      const [path, renameFrom] = tail.split('\t');
      s.entries.push({ path, code: parts[0], renameFrom });
    } else if (record.startsWith('? ')) {
      s.entries.push({ path: record.slice(2), code: '??' });
    } else if (record.startsWith('! ')) {
      s.entries.push({ path: record.slice(2), code: '!!' });
    }
  }
  return s;
}

export async function getStatus(repoPath: string): Promise<CoreStatus> {
  const { stdout } = await runGit(['status', '--porcelain=v2', '-z', '--branch'], { cwd: repoPath });
  return parsePorcelainV2(stdout);
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/core test -- status.test.ts` → Expected: PASS（2 个用例）。

```powershell
git add packages/server/core
git commit -m "feat(core): porcelain v2 status 解析（分支/上游/领先落后/重命名）"
```

---

### Task 7: core —— log 流式解析（--graph）

**Files:**
- Create: `packages/server/core/src/log.ts`
- Test: `packages/server/core/src/log.test.ts`

**Interfaces:**
- Consumes: `streamGit`（`./exec`）。
- Produces: `CoreCommit { hash, shortHash, parents, author, authorEmail, dateIso, refs, message, graph }`、`parseLogRecord(raw): CoreCommit`、`streamLog(repoPath, opts): AsyncIterable<CoreCommit>`（opts: `{ skip?, maxCount?, author?, path?, signal? }`）。

- [ ] **Step 1: 写失败测试 `log.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLogRecord, streamLog } from './log';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function commit(repo: string, file: string, msg: string): void {
  writeFileSync(join(repo, file), msg);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
}

describe('log 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('parseLogRecord 解析全字段与多行 message', () => {
    const raw = '| * \x01' + ['abc', 'abc123', 'p1 p2', '张三', 'a@b.c', '2026-09-01T10:00:00+08:00', 'HEAD -> main, tag: v1', '第一行\n第二行'].join('\x1f') + '\x02';
    const c = parseLogRecord(raw);
    expect(c.hash).toBe('abc');
    expect(c.parents).toEqual(['p1', 'p2']);
    expect(c.refs).toEqual(['HEAD -> main', 'tag: v1']);
    expect(c.message).toBe('第一行\n第二行');
    expect(c.graph).toBe('| *');
  });

  it('streamLog 在双分支仓库产出全部提交', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'c1');
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'feature']);
    commit(repo, 'b.txt', 'c2');
    const commits = [];
    for await (const c of streamLog(repo, { maxCount: 10 })) commits.push(c);
    expect(commits).toHaveLength(2);
    expect(commits.some((c) => c.message === 'c1')).toBe(true);
    expect(commits.some((c) => c.message === 'c2')).toBe(true);
    expect(commits.every((c) => c.graph.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- log.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `log.ts`**

```ts
/**
 * log 流式解析：--graph + 自定义分隔符。
 * 记录帧 = <graph列>\x01<7 字段以 \x1f 分隔>\x02；\x02 为记录边界，支持多行 message。
 */
import { streamGit } from './exec';

const FIELD_SEP = '\x1f';
const PREFIX_SEP = '\x01';
const RECORD_SEP = '\x02';

export interface CoreCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  dateIso: string;
  refs: string[];
  message: string;
  graph: string;
}

/** 解析单条记录（graph 前缀 + \x01 + 字段） */
export function parseLogRecord(raw: string): CoreCommit {
  const i = raw.indexOf(PREFIX_SEP);
  const graph = raw.slice(0, i).trimEnd();
  const body = raw.slice(i + 1, raw.endsWith(RECORD_SEP) ? -1 : undefined);
  const parts = body.split(FIELD_SEP);
  const [hash, shortHash, parentsStr, author, authorEmail, dateIso, refsStr, ...rest] = parts;
  return {
    hash,
    shortHash,
    parents: parentsStr === '' ? [] : parentsStr.split(' '),
    author,
    authorEmail,
    dateIso,
    refs: refsStr === '' ? [] : refsStr.split(', '),
    message: rest.join(FIELD_SEP),
    graph,
  };
}

export interface StreamLogOptions {
  skip?: number;
  maxCount?: number;
  author?: string;
  path?: string;
  signal?: AbortSignal;
}

/** 流式产出提交（逐条解析，不整库读入内存；分页用 --skip） */
export async function* streamLog(repoPath: string, opts: StreamLogOptions = {}): AsyncIterable<CoreCommit> {
  const args = ['log', '--graph', '--date-order', `--format=${PREFIX_SEP}%H${FIELD_SEP}%h${FIELD_SEP}%P${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%B${RECORD_SEP}`];
  if (opts.skip) args.push(`--skip=${opts.skip}`);
  if (opts.maxCount) args.push(`--max-count=${opts.maxCount}`);
  if (opts.author) args.push(`--author=${opts.author}`);
  if (opts.path) args.push('--', opts.path);

  let buffer = '';
  for await (const chunk of streamGit(args, { cwd: repoPath, signal: opts.signal })) {
    buffer += chunk;
    let idx: number;
    // 以 \x02 切记录，保留尾部不完整帧
    while ((idx = buffer.indexOf(RECORD_SEP)) >= 0) {
      const record = buffer.slice(0, idx + 1);
      buffer = buffer.slice(idx + 1);
      if (record.trim().length > 1) yield parseLogRecord(record);
    }
  }
  if (buffer.trim().length > 0) yield parseLogRecord(buffer);
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/core test -- log.test.ts` → Expected: PASS（2 个用例）。

```powershell
git add packages/server/core
git commit -m "feat(core): 流式 log --graph 解析（记录帧分隔，多行 message）"
```

---

### Task 8: core —— diff 输出

**Files:**
- Create: `packages/server/core/src/diff.ts`
- Test: `packages/server/core/src/diff.test.ts`

**Interfaces:**
- Consumes: `runGit`、`streamGit`（`./exec`）。
- Produces: `collectFileDiff(repoPath, opts): Promise<string>`、`streamFileDiff(repoPath, opts): AsyncIterable<string>`（opts: `{ file, from?, to?, staged?, signal? }`）。

- [ ] **Step 1: 写失败测试 `diff.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFileDiff, streamFileDiff } from './diff';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('diff 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('collectFileDiff 输出未暂存修改', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const text = await collectFileDiff(repo, { file: 'a.txt' });
    expect(text).toContain('--- a/a.txt');
    expect(text).toContain('+v2');
  });

  it('staged 模式只看暂存区，from/to 比较两个提交', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    const staged = await collectFileDiff(repo, { file: 'a.txt', staged: true });
    expect(staged).toContain('+v2');
    const ranged = await collectFileDiff(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD' });
    expect(ranged).toBe('');
  });

  it('streamFileDiff 分块产出与 collect 内容一致', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const text = await collectFileDiff(repo, { file: 'a.txt' });
    let streamed = '';
    for await (const chunk of streamFileDiff(repo, { file: 'a.txt' })) streamed += chunk;
    expect(streamed).toBe(text);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- diff.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `diff.ts`**

```ts
/** diff 原语：--no-ext-diff 禁外部差异工具；P1 输出 unified diff 全文/流。 */
import { runGit, streamGit } from './exec';

export interface FileDiffOptions {
  file: string;
  from?: string;
  to?: string;
  staged?: boolean;
  signal?: AbortSignal;
}

function buildDiffArgs(opts: FileDiffOptions): string[] {
  const args = ['diff', '--no-ext-diff'];
  if (opts.staged) args.push('--staged');
  else if (opts.from !== undefined && opts.to !== undefined) args.push(opts.from, opts.to);
  args.push('--', opts.file);
  return args;
}

/** 单文件 diff 全文（小/中体积场景） */
export async function collectFileDiff(repoPath: string, opts: FileDiffOptions): Promise<string> {
  const { stdout } = await runGit(buildDiffArgs(opts), { cwd: repoPath, signal: opts.signal });
  return stdout;
}

/** 单文件 diff 流式产出（大文件场景，框架层转 SSE） */
export async function* streamFileDiff(repoPath: string, opts: FileDiffOptions): AsyncIterable<string> {
  yield* streamGit(buildDiffArgs(opts), { cwd: repoPath, signal: opts.signal });
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/core test -- diff.test.ts` → Expected: PASS（3 个用例）。

```powershell
git add packages/server/core
git commit -m "feat(core): 单文件 diff 全文与流式输出"
```

---

### Task 9: api —— 配置持久化与 settings

**Files:**
- Create: `packages/server/api/src/lib/config-store.ts`、`src/settings.ts`
- Test: `packages/server/api/src/settings.test.ts`

**Interfaces:**
- Consumes: `SettingsState`、`SettingsPatch`（`@rebased/contracts`）。
- Produces: `getConfigDir(): string`（lib，测试可用 `REBASED_CONFIG_DIR` 覆盖）、`loadConfig(): AppConfig`、`saveConfig(config): void`（lib）；`getSettings(): SettingsState`、`updateSettings(patch): SettingsState`（settings.ts）。

- [ ] **Step 1: 写失败测试 `settings.test.ts`**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSettings, updateSettings } from './settings';

let configDir: string;

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'rebased-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

describe('settings', () => {
  it('默认 logInEditor=true，recentRepoIds 为空', () => {
    expect(getSettings()).toEqual({ logInEditor: true, recentRepoIds: [] });
  });

  it('updateSettings 部分更新并持久化', () => {
    updateSettings({ logInEditor: false });
    expect(getSettings().logInEditor).toBe(false);
    updateSettings({ recentRepoIds: ['r1'] });
    expect(getSettings()).toEqual({ logInEditor: false, recentRepoIds: ['r1'] });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- settings.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/config-store.ts`**

```ts
/** 应用配置持久化（内部基础设施，不进公共出口）：JSON 文件 + 原子可覆盖写。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RepoInfo, SettingsState } from '@rebased/contracts';

export interface AppConfig {
  repos: RepoInfo[];
  settings: SettingsState;
}

const DEFAULTS: AppConfig = {
  repos: [],
  settings: { logInEditor: true, recentRepoIds: [] },
};

/** 配置目录：REBASED_CONFIG_DIR（测试）> ~/.rebasedjs（生产） */
export function getConfigDir(): string {
  return process.env.REBASED_CONFIG_DIR ?? join(homedir(), '.rebasedjs');
}

function configFile(): string {
  return join(getConfigDir(), 'config.json');
}

export function loadConfig(): AppConfig {
  const file = configFile();
  if (!existsSync(file)) return structuredClone(DEFAULTS);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>;
  return { ...structuredClone(DEFAULTS), ...parsed, settings: { ...DEFAULTS.settings, ...parsed.settings } };
}

export function saveConfig(config: AppConfig): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf8');
}
```

- [ ] **Step 4: 实现 `src/settings.ts`**

```ts
/** 应用设置：UI 偏好（log 位置）与最近仓库 id；持久化复用 lib/config-store。 */
import type { SettingsPatch, SettingsState } from '@rebased/contracts';
import { loadConfig, saveConfig } from './lib/config-store';

export function getSettings(): SettingsState {
  return loadConfig().settings;
}

export function updateSettings(patch: SettingsPatch): SettingsState {
  const config = loadConfig();
  config.settings = { ...config.settings, ...patch };
  saveConfig(config);
  return config.settings;
}
```

- [ ] **Step 5: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/api test -- settings.test.ts` → Expected: PASS（2 个用例）。

```powershell
git add packages/server/api
git commit -m "feat(api): 应用设置持久化（JSON 配置存储）"
```

---

### Task 10: api —— repo 功能文件（打开/列表/初始化/克隆）

**Files:**
- Create: `packages/server/api/src/repo.ts`
- Test: `packages/server/api/src/repo.test.ts`

**Interfaces:**
- Consumes: `findRepoRoot`、`initGitRepo`、`cloneGitRepo`（`@rebased/core`）；`ServiceError`（`@rebased/contracts`）；`loadConfig`/`saveConfig`（`./lib/config-store`）。
- Produces: `openRepo(path): Promise<RepoInfo>`、`listRecentRepos(): RepoInfo[]`、`getRepoById(id): RepoInfo`、`initRepo(path): Promise<RepoInfo>`、`cloneRepo(url, targetDir): Promise<RepoInfo>`。

- [ ] **Step 1: 写失败测试 `repo.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRepo, getRepoById, initRepo, listRecentRepos, openRepo } from './repo';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

let configDir: string;
const dirs: string[] = [];

beforeAll(() => {
  // 配置目录隔离：每个测试文件独立 REBASED_CONFIG_DIR，避免污染用户配置
  configDir = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

describe('repo 功能', () => {
  it('openRepo 注册仓库并返回 RepoInfo，非仓库抛 NOT_A_GIT_REPO', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const info = await openRepo(repo);
    expect(info.path).toBe(repo);
    expect(info.name).toBe(repo.split(/[\\/]/).pop());
    expect(listRecentRepos().some((r) => r.id === info.id)).toBe(true);
    await expect(openRepo(join(repo, '..'))).rejects.toMatchObject({ code: 'NOT_A_GIT_REPO' });
  });

  it('getRepoById 未注册抛 REPO_NOT_FOUND', () => {
    expect(() => getRepoById('no-such-id')).toThrowError(expect.objectContaining({ code: 'REPO_NOT_FOUND' }));
  });

  it('initRepo 与 cloneRepo 落库注册', async () => {
    const t1 = join(tmpdir(), `rebased-api-init-${Date.now()}`);
    dirs.push(t1);
    const i1 = await initRepo(t1);
    expect(getRepoById(i1.id).path).toBe(t1);

    const src = createTmpRepo();
    dirs.push(src);
    const t2 = join(tmpdir(), `rebased-api-clone-${Date.now()}`);
    dirs.push(t2);
    const i2 = await cloneRepo(src, t2);
    expect(getRepoById(i2.id).path).toBe(t2);
  });

  it('重复 openRepo 同一路径复用同一仓库', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const a = await openRepo(repo);
    const b = await openRepo(repo);
    expect(b.id).toBe(a.id);
  });
});
```

> 注：core 的测试夹具不进公共出口，api 测试自建同内容夹具 `packages/server/api/src/testing/tmp-repo.ts`（复制 `packages/server/core/src/testing/tmp-repo.ts`）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- repo.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `repo.ts`**

```ts
/** 仓库功能：打开（验证+注册）、最近列表、按 id 取、初始化、克隆。 */
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { cloneGitRepo, findRepoRoot, initGitRepo } from '@rebased/core';
import type { RepoInfo } from '@rebased/contracts';
import { ServiceError } from '@rebased/contracts';
import { loadConfig, saveConfig } from './lib/config-store';

/** 验证 path 是 git 仓库并注册到最近列表（同路径复用既有 id） */
export async function openRepo(path: string): Promise<RepoInfo> {
  const root = await findRepoRoot(path);
  if (root === null) throw new ServiceError('NOT_A_GIT_REPO', `不是 git 仓库：${path}`, { context: { path } });

  const config = loadConfig();
  const existing = config.repos.find((r) => r.path === root);
  const repo: RepoInfo = existing ?? {
    id: randomUUID(),
    path: root,
    name: basename(root),
    openedAt: new Date().toISOString(),
  };
  repo.openedAt = new Date().toISOString();
  config.repos = [repo, ...config.repos.filter((r) => r.id !== repo.id)];
  config.settings.recentRepoIds = [repo.id, ...config.settings.recentRepoIds.filter((id) => id !== repo.id)].slice(0, 20);
  saveConfig(config);
  return repo;
}

export function listRecentRepos(): RepoInfo[] {
  return loadConfig().repos.slice(0, 20);
}

export function getRepoById(id: string): RepoInfo {
  const repo = loadConfig().repos.find((r) => r.id === id);
  if (!repo) throw new ServiceError('REPO_NOT_FOUND', `仓库不存在或未打开：${id}`, { context: { id } });
  return repo;
}

export async function initRepo(path: string): Promise<RepoInfo> {
  await initGitRepo(path);
  return openRepo(path);
}

export async function cloneRepo(url: string, targetDir: string): Promise<RepoInfo> {
  await cloneGitRepo(url, targetDir);
  return openRepo(targetDir);
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/api test -- repo.test.ts` → Expected: PASS（4 个用例）。

```powershell
git add packages/server/api
git commit -m "feat(api): repo 功能文件（打开/最近/初始化/克隆）"
```

---

### Task 11: api —— status 功能文件

**Files:**
- Create: `packages/server/api/src/status.ts`
- Test: `packages/server/api/src/status.test.ts`

**Interfaces:**
- Consumes: `getStatus`（`@rebased/core`）；`RepoStatus`（`@rebased/contracts`）。
- Produces: `getRepoStatus(repoPath: string): Promise<RepoStatus>`。

- [ ] **Step 1: 写失败测试 `status.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRepoStatus } from './status';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('status 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('映射为契约形状（分支/变更条目/重命名）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'b.txt'), 'new');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'c.txt']);
    const s = await getRepoStatus(repo);
    expect(s.branch).toBeTruthy();
    expect(s.upstream).toBeNull();
    expect(s.ahead).toBe(0);
    expect(s.entries.some((e) => e.path === 'c.txt' && e.renameFrom === 'a.txt')).toBe(true);
    expect(s.entries.some((e) => e.path === 'b.txt' && e.code === '??')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- status.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `status.ts`**

```ts
/** 仓库状态功能：core 原语 → contracts 形状的薄映射。 */
import { getStatus } from '@rebased/core';
import type { RepoStatus } from '@rebased/contracts';

export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  const s = await getStatus(repoPath);
  return {
    branch: s.branch,
    upstream: s.upstream,
    ahead: s.ahead,
    behind: s.behind,
    entries: s.entries.map((e) => ({ path: e.path, code: e.code, renameFrom: e.renameFrom })),
  };
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/api test -- status.test.ts` → Expected: PASS。

```powershell
git add packages/server/api
git commit -m "feat(api): status 功能文件"
```

---

### Task 12: api —— log 功能文件（分页 + 事件流）

**Files:**
- Create: `packages/server/api/src/log.ts`
- Test: `packages/server/api/src/log.test.ts`

**Interfaces:**
- Consumes: `streamLog`、`CoreCommit`（`@rebased/core`）；`LogQuery`、`LogPage`、`CommitInfo`、`LogEvent`（`@rebased/contracts`）。
- Produces: `getLogPage(repoPath, query): Promise<LogPage>`、`streamLogEvents(repoPath, query): AsyncIterable<LogEvent>`。

- [ ] **Step 1: 写失败测试 `log.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLogPage, streamLogEvents } from './log';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function commit(repo: string, file: string, msg: string): void {
  writeFileSync(join(repo, file), msg);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
}

describe('log 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getLogPage 返回分页与 hasMore 标志', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    for (let i = 1; i <= 3; i++) commit(repo, `f${i}.txt`, `c${i}`);
    const p1 = await getLogPage(repo, { limit: 2, skip: 0 });
    expect(p1.commits).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const p2 = await getLogPage(repo, { limit: 2, skip: 2 });
    expect(p2.commits).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
  });

  it('streamLogEvents 产出契约事件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'only');
    const events = [];
    for await (const e of streamLogEvents(repo, { limit: 10, skip: 0 })) events.push(e);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'log.line', payload: expect.objectContaining({ message: 'only', parents: [] }) });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- log.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `log.ts`**

```ts
/** log 功能：分页查询与流式事件。core 提交 → contracts CommitInfo 映射在此完成。 */
import { streamLog, type CoreCommit } from '@rebased/core';
import type { CommitInfo, LogEvent, LogPage, LogQuery } from '@rebased/contracts';

function toCommitInfo(c: CoreCommit): CommitInfo {
  return {
    hash: c.hash,
    shortHash: c.shortHash,
    parents: c.parents,
    author: c.author,
    authorEmail: c.authorEmail,
    dateIso: c.dateIso,
    refs: c.refs,
    message: c.message,
    graph: c.graph,
  };
}

export async function getLogPage(repoPath: string, query: LogQuery): Promise<LogPage> {
  const commits: CommitInfo[] = [];
  for await (const c of streamLog(repoPath, { skip: query.skip, maxCount: query.limit, author: query.author, path: query.path })) {
    commits.push(toCommitInfo(c));
  }
  return { commits, hasMore: commits.length === query.limit };
}

export async function* streamLogEvents(repoPath: string, query: LogQuery): AsyncIterable<LogEvent> {
  for await (const c of streamLog(repoPath, { skip: query.skip, maxCount: query.limit, author: query.author, path: query.path })) {
    yield { type: 'log.line', payload: toCommitInfo(c) };
  }
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/api test -- log.test.ts` → Expected: PASS（2 个用例）。

```powershell
git add packages/server/api
git commit -m "feat(api): log 功能文件（分页 + SSE 事件流）"
```

---

### Task 13: api —— diff 功能文件

**Files:**
- Create: `packages/server/api/src/diff.ts`
- Test: `packages/server/api/src/diff.test.ts`

**Interfaces:**
- Consumes: `collectFileDiff`、`streamFileDiff`（`@rebased/core`）；`DiffQuery`、`DiffFile`、`DiffEvent`（`@rebased/contracts`）。
- Produces: `getFileDiff(repoPath, query): Promise<DiffFile>`、`streamDiffEvents(repoPath, query): AsyncIterable<DiffEvent>`。

- [ ] **Step 1: 写失败测试 `diff.test.ts`**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFileDiff, streamDiffEvents } from './diff';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('diff 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getFileDiff 返回契约形状', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const d = await getFileDiff(repo, { file: 'a.txt', staged: false });
    expect(d.path).toBe('a.txt');
    expect(d.text).toContain('+v2');
  });

  it('streamDiffEvents 产出契约事件且内容与全文一致', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const full = await getFileDiff(repo, { file: 'a.txt', staged: false });
    let text = '';
    for await (const e of streamDiffEvents(repo, { file: 'a.txt', staged: false })) {
      expect(e.type).toBe('diff.chunk');
      text += e.payload.text;
    }
    expect(text).toBe(full.text);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- diff.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `diff.ts`**

```ts
/** diff 功能：单文件全文与流式事件，core 原语 → contracts 形状。 */
import { collectFileDiff, streamFileDiff } from '@rebased/core';
import type { DiffEvent, DiffFile, DiffQuery } from '@rebased/contracts';

export async function getFileDiff(repoPath: string, query: DiffQuery): Promise<DiffFile> {
  const text = await collectFileDiff(repoPath, query);
  return { path: query.file, text };
}

export async function* streamDiffEvents(repoPath: string, query: DiffQuery): AsyncIterable<DiffEvent> {
  for await (const chunk of streamFileDiff(repoPath, query)) {
    yield { type: 'diff.chunk', payload: { text: chunk } };
  }
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/api test -- diff.test.ts` → Expected: PASS（2 个用例）。

```powershell
git add packages/server/api
git commit -m "feat(api): diff 功能文件（全文 + SSE 事件流）"
```

---

### Task 14: api —— errors 辅助与统一错误出口

**Files:**
- Create: `packages/server/api/src/errors.ts`
- Test: `packages/server/api/src/errors.test.ts`

**Interfaces:**
- Consumes: `ServiceError`（`@rebased/contracts`）、`GitExitError`（`@rebased/core`）。
- Produces: `toServiceError(error: unknown): ServiceError`（同时 `export * from '@rebased/contracts'` 的错误相关符号由 index 统一导出）。

- [ ] **Step 1: 写失败测试 `errors.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GitExitError } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import { toServiceError } from './errors';

describe('toServiceError', () => {
  it('ServiceError 原样返回', () => {
    const e = new ServiceError('CONFLICT', '有冲突');
    expect(toServiceError(e)).toBe(e);
  });

  it('GitExitError 映射为 GIT_ERROR 并携带 stderr 上下文', () => {
    const g = new GitExitError(['status'], 128, '', 'fatal: not a git repository');
    const s = toServiceError(g);
    expect(s.code).toBe('GIT_ERROR');
    expect(s.cause).toBe(g);
    expect((s.context as { stderr: string }).stderr).toContain('fatal');
  });

  it('未知错误兜底为 GIT_ERROR', () => {
    const s = toServiceError(new Error('boom'));
    expect(s.code).toBe('GIT_ERROR');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- errors.test.ts` → Expected: FAIL。

- [ ] **Step 3: 实现 `errors.ts`**

```ts
/** 错误出口：统一把引擎层/未知错误折成 ServiceError，框架层只需面对一种错误。 */
import { GitExitError } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';

export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof GitExitError) {
    return new ServiceError('GIT_ERROR', `git 命令失败：${error.message}`, {
      cause: error,
      context: { args: error.args, exitCode: error.exitCode, stderr: error.stderr },
    });
  }
  return new ServiceError('GIT_ERROR', '内部错误', { cause: error });
}
```

- [ ] **Step 4: 运行测试确认通过并提交**

Run: `pnpm --filter @rebased/api test -- errors.test.ts` → Expected: PASS（3 个用例）。

```powershell
git add packages/server/api
git commit -m "feat(api): 统一错误出口 toServiceError"
```

---

### Task 15: 公共出口、AGENT.md 更新与全链验收

**Files:**
- Create: `packages/server/contracts/src/index.ts`、`packages/server/core/src/index.ts`、`packages/server/api/src/index.ts`
- Modify: `AGENT.md`（目录与分层说明替换为 7 包结构）

**Interfaces:**
- Consumes: 各包已完成的功能文件。
- Produces: `@rebased/contracts` 全量导出；`@rebased/core` 导出 exec/repo/status/log/diff（不含 testing）；`@rebased/api` 导出 repo/status/log/diff/settings/errors。

- [ ] **Step 1: 写三个包的 index.ts**

`packages/server/contracts/src/index.ts`：

```ts
/** contracts 公共出口：领域类型 + 端点 schema + 错误模型 + SSE 序列化。 */
export * from './domain';
export * from './endpoints';
export * from './errors';
export * from './sse';
```

`packages/server/core/src/index.ts`：

```ts
/** core 公共出口：git CLI 引擎原语。testing 夹具与内部实现不进本出口。 */
export { GitExitError, runGit, streamGit } from './exec';
export { cloneGitRepo, findRepoRoot, initGitRepo } from './repo';
export { getStatus, parsePorcelainV2 } from './status';
export type { CoreChangeEntry, CoreStatus } from './status';
export { parseLogRecord, streamLog } from './log';
export type { CoreCommit, StreamLogOptions } from './log';
export { collectFileDiff, streamFileDiff } from './diff';
export type { FileDiffOptions } from './diff';
```

`packages/server/api/src/index.ts`：

```ts
/** api 公共出口：功能服务层（一个功能一个文件），框架层只从这里 import。 */
export { cloneRepo, getRepoById, initRepo, listRecentRepos, openRepo } from './repo';
export { getRepoStatus } from './status';
export { getLogPage, streamLogEvents } from './log';
export { getFileDiff, streamDiffEvents } from './diff';
export { getSettings, updateSettings } from './settings';
export { toServiceError } from './errors';
```

- [ ] **Step 2: 更新 AGENT.md 目录与依赖方向**

把 AGENT.md 的 `## 目录` 一节整节替换为：

```markdown
## 目录

monorepo：2 个下游应用 + 服务端/客户端两层，职责严格分离（设计见 `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`）：

```text
rebasedjs/
├── apps/
│   ├── web-next/       # 下游应用①：Next.js 薄组装（页面壳 + 路由转调 api）
│   └── web-koa/        # 下游应用②：Koa 薄组装（路由 + 静态托管同一 SPA）
├── packages/
│   ├── server/
│   │   ├── core/       # git CLI 引擎封装（流式原语、进程管理），零依赖
│   │   ├── api/        # 功能服务层：一个功能一个文件，禁框架依赖
│   │   └── contracts/  # 跨端契约：zod schema + 领域类型 + 错误码 + SSE 事件
│   └── client/
│       ├── ui/         # 纯展示组件（基础 + 组合），不调接口
│       └── client/     # 数据层：SWR hooks + SSE 订阅 hooks
├── docs/
└── eslint.shared.ts    # 共享规则 + 分层边界规则（withBoundary）
```

- **core**：与 git 进程打交道的引擎层，无任何业务；测试用真实 git CLI
- **api**：后端逻辑，每个小功能 1 个文件；只依赖 core + contracts，禁止 import 任何框架
- **contracts**：服务端与客户端共享的类型/校验/错误契约
- **ui**：只做基础组件和组合组件，不涉及任何接口调用，纯数据驱动
- **client**：数据获取 hooks（SWR + SSE），类型全部来自 contracts
- **web-next / web-koa**：框架层，路由只做「zod 校验 → 调 api → 错误映射」三件事

依赖方向：`web-next → api/ui/client/contracts`；`web-koa → api/contracts`；`ui → contracts`；`client → contracts`；`api → core/contracts`；`core → 无`。边界由 `eslint.shared.ts` 的 `withBoundary()` 硬约束。
```

其余各节（约束/命令/注释/日志/技术栈）保持不变；技术栈一节中的路由描述改为"web-next：App Router（Server Components + Server Actions + API Routes）；web-koa：koa-router"。

- [ ] **Step 3: 全链验收**

```powershell
pnpm install
pnpm typecheck   # 预期：三个 server 包 tsc 全绿（跨包类型经 @rebased/* 解析）
pnpm format      # 预期：边界规则与共享规则零违规
pnpm test        # 预期：contracts 7 + core 15 + api 16 = 38 个用例全绿（core 15 含 Task 7 帧边界回归用例）
```

- [ ] **Step 4: 提交**

```powershell
git add packages/server AGENT.md
git commit -m "feat: 服务端核心公共出口与 AGENT.md 分层文档"
```

**计划 1 完成标准**：`pnpm typecheck && pnpm format && pnpm test` 三绿；`api` 的 5 个功能文件（repo/status/log/diff/settings）可在无 HTTP 环境下被 vitest 直接调用；任何 `import 'react'`/`import 'next'` 出现在 `core`/`api` 内都会被 eslint 拒绝。

---

## 自审记录（本计划 vs spec）

- spec §7 步骤 1（骨架/边界/AGENT.md）→ Task 1、Task 15 ✓
- spec §7 步骤 2（contracts：类型 + P1 schema + 错误码）→ Task 2、Task 3 ✓（`httpStatusFor`、SSE 序列化随契约落）
- spec §7 步骤 3（core：exec/repo/status/log/diff + 集成测试）→ Task 4–8 ✓
- spec §7 步骤 4（api：repo/status/log/diff/settings/errors + 测试）→ Task 9–14 ✓
- spec §4.2 P1 行（repo/status/log/diff/settings/errors）全部有对应任务 ✓
- spec §6 测试矩阵：core 真实 git + fixture（Task 4–8）、api 不经 HTTP 直调（Task 9–13）、contracts zod/映射/SSE 单测（Task 2–3）✓
- 占位符扫描：无 TBD/TODO/"类似 Task N"；所有步骤含可执行代码或命令 ✓
- 类型一致性：`runGit`/`streamGit` 签名（Task 4 定义，Task 5–8 使用）、`ServiceError` 构造（Task 2 定义，Task 10/14 使用）、`LogQuery` 字段（Task 3 定义，Task 12 使用）一致 ✓
- 已知简化（spec 允许范围内）：log 分页用 `--skip`（大仓库可换提交游标，计划 2 的 graph-layout 任务中一并评估）；P1 diff 为全文/流，hunk 结构化推迟到 P2 `staging.ts`；apps 与 client 包仅占位。
