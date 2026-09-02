# Rebased.js Plan 2b：客户端层与双应用组装运行 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 组装 `apps/web-next`（Next.js，3030）与 `apps/web-koa`（Koa + Vite SPA，3031）两个下游应用并运行起来：打开仓库 → CommitGraph 真图渲染（SSE 增量）→ Monaco DiffEditor 单文件对比 → 状态条/事件推送，UX 对齐 Java 版 Rebased 的 6 项细节。

**Architecture:** 遵循既有分层：`ui`（纯展示组件 base/domain/composite + graph-layout 已就绪）← `client`（SWR/SSE hooks，类型来自 contracts）→ 两个薄应用壳（路由只做「zod 校验 → 调 api → toServiceError 映射」）。web-koa 的 SPA 与 web-next 页面共享同一套 ui/client；API 端点两侧完全对称。

**Tech Stack:** Next.js 16.2.7 + React 19 + antd 6 + Tailwind、Koa + @koa/router + @koa/bodyparser + koa-static、Vite 7.3.6（Ruling 6/9 钉版）+ @vitejs/plugin-react、SWR、Monaco Editor（懒加载）、vitest（jsdom + node 双环境）、@testing-library/react。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-apps-assembly-design.md`（全部章节）。前置：Plan 2a 完成（74 用例），终审前置清单（SSE 流错误呈现、rev:'' 404 映射、ui index 导出 graph-layout 等）随任务消化。

## Global Constraints

- 分层边界（eslint 硬约束）：`ui` 禁 import client/api/apps；`client` 禁 import apps；`web-next`/`web-koa` 互禁；core/api 禁框架（既有）。
- `ui` 纯客户端 React：**禁用 RSC 专属 API**（同一套组件被 Next client components 与 Vite SPA 共享）。
- `ui` 组件不发起接口调用（数据由 props/hooks 注入）；`client` 不持业务逻辑。
- 路由三件套模板：zod 校验（contracts schema）→ getRepoById → 调 api → toServiceError + httpStatusFor + `{error:{code,message,context?}}`；SSE 帧统一 `serializeSseEvent`。
- 质量门：`pnpm typecheck` → `pnpm format` → `pnpm test` 全绿（完成后全链 74 + 新增 ≈ 110+）。
- 注释风格：TS/TSX 用 JSDoc 中文，先说"做什么"再说"怎么做"；antd + Tailwind，避免裸写 div。
- 端口：web-next 3030、web-koa 3031（Koa API）；Vite dev server 5173 代理 `/api` → 3031；生产 `vite build` → koa-static。
- 镜像安装：`pnpm.overrides vite 7.3.6` 既有；新依赖若遇镜像缺版本，按 Plan 1 先例上报裁定，不自改钉版。
- 分支 `feat/server-core`（HEAD d036898）；本计划完成后与用户确认合并决策。

---

### Task 1: 依赖安装与包配置（四个包的基建）

**Files:**
- Modify: `packages/client/ui/package.json`、`packages/client/client/package.json`、`apps/web-next/package.json`、`apps/web-koa/package.json`
- Create: `apps/web-next/next.config.ts`、`apps/web-koa/vite.config.ts`、`apps/web-koa/index.html`、`apps/web-koa/src/main.tsx`（占位）
- Modify: `packages/client/ui/vitest.config.ts`（node → 双环境 jsdom）、`apps/*/tsconfig.json`（若需）

**Interfaces:**
- Consumes: 无。
- Produces: 四个包的可安装依赖集；next.config（transpilePackages）；vite.config（react 插件 + /api 代理）。

- [ ] **Step 1: 写依赖清单并更新四个 package.json**

`packages/client/ui/package.json` 追加 dependencies/devDependencies：

```json
  "dependencies": {
    "@ant-design/icons": "^6.3.2",
    "@rebased/contracts": "workspace:*",
    "antd": "^6.5.3",
    "monaco-editor": "^0.52.0",
    "react": "19.2.7"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.7",
    "jsdom": "^29.1.1",
    "react-dom": "19.2.7"
  }
```

`packages/client/client/package.json`：

```json
  "dependencies": {
    "@rebased/contracts": "workspace:*",
    "swr": "^2.3.0"
  },
  "devDependencies": {
    "react": "19.2.7",
    "@types/react": "^19.2.7"
  }
```

`apps/web-next/package.json`（在既有 devDeps 基础上追加）：

```json
  "dependencies": {
    "@ant-design/icons": "^6.3.2",
    "@rebased/api": "workspace:*",
    "@rebased/client": "workspace:*",
    "@rebased/contracts": "workspace:*",
    "@rebased/ui": "workspace:*",
    "antd": "^6.5.3",
    "next": "16.2.7",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "swr": "^2.3.0",
    "tailwindcss": "^3.4.0",
    "zod": "^3.25.28"
  },
  "scripts": {
    "dev": "next dev -p 3030",
    "build": "next build",
    "start": "next start -p 3030"
  }
```

`apps/web-koa/package.json`：

```json
  "dependencies": {
    "@koa/bodyparser": "^5.3.0",
    "@koa/router": "^13.1.0",
    "@rebased/api": "workspace:*",
    "@rebased/contracts": "workspace:*",
    "koa": "^2.15.4",
    "koa-static": "^5.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.0",
    "tsx": "^4.22.4",
    "vite": "7.3.6"
  },
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "dev:web": "vite",
    "build": "vite build",
    "build:server": "tsc --noEmit"
  }
```

- [ ] **Step 2: next.config.ts**

```ts
/** Next 配置：monorepo 源码直引（transpilePackages 编译 workspace TS 包） */
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@rebased/ui', '@rebased/client', '@rebased/contracts'],
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 3: vite.config.ts（web-koa SPA）**

```ts
/** Vite SPA：dev 下代理 /api → Koa(3031)；页面与 API 同源语义 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3031',
    },
  },
  build: { outDir: 'public' },
});
```

`apps/web-koa/index.html`（标准 Vite 入口，挂载 `src/main.tsx`）与 `src/main.tsx` 占位（渲染空 div，Task 4 后接真组件）：

```tsx
import { createRoot } from 'react-dom/client';
// SPA 入口：与 web-next 共享 ui/client（Plan 2b Task 4 后挂载真实页面）
createRoot(document.getElementById('root')!).render(<div>Rebased.js SPA</div>);
```

- [ ] **Step 4: ui vitest 配置双环境**

`packages/client/ui/vitest.config.ts` 改为：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // graph-layout 纯函数与组件测试并存：jsdom 下纯函数测试同样可跑
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    setupFiles: ['src/testing/setup.ts'],
  },
});
```

`src/testing/setup.ts`：`import '@testing-library/jest-dom';`（devDeps 加 `@testing-library/jest-dom`）。

- [ ] **Step 5: pnpm install 并验证**

Run: `pnpm install`（镜像；新依赖若缺版本即上报，不自改钉版）→ `pnpm typecheck` 全仓绿（四个包的新 tsconfig 生效）→ `pnpm format` 绿。

- [ ] **Step 6: 提交**

```powershell
git add packages/client apps pnpm-lock.yaml
git commit -m "feat: ui/client/web-next/web-koa 依赖与构建配置（Vite 代理、Next transpile）"
```

---

### Task 2: ui base 组件（VirtualList / GraphCanvas / MonacoDiffView / EmptyState）

**Files:**
- Create: `packages/client/ui/src/base/virtual-list.tsx`、`graph-canvas.tsx`、`monaco-diff-view.tsx`、`empty-state.tsx` + 各自测试
- Modify: `packages/client/ui/src/index.ts`（导出 base）

**Interfaces:**
- Consumes: `LayoutRow`/`EdgeSegment`（`../graph-layout/types`）。
- Produces: `VirtualList<T>({ items, rowHeight, height, renderRow })`（固定行高窗口渲染）；`GraphCanvas({ rows, rowHeight })`（SVG 边线段 + 节点圆点）；`MonacoDiffView({ original, modified, language?, options? })`（React.lazy 懒加载 monaco-editor）；`EmptyState({ title, description?, action? })`。

- [ ] **Step 1: 写失败测试**

`virtual-list.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VirtualList } from './virtual-list';

describe('VirtualList', () => {
  it('仅渲染可见窗口内的行', () => {
    render(
      <VirtualList items={Array.from({ length: 100 }, (_, i) => `row${i}`)} rowHeight={20} height={100} renderRow={(item) => <div>{item}</div>} />,
    );
    // 100px / 20px = 5 行可见（含 overscan 容差）
    expect(screen.getAllByText(/^row\d+$/).length).toBeLessThanOrEqual(10);
    expect(screen.getByText('row0')).toBeInTheDocument();
  });
});
```

`graph-canvas.test.tsx`：给定 3 行 LayoutRow（lane 0/1、含跨行边），断言 SVG 内线段数 ≥ 行数（`container.querySelectorAll('line')` 非空）且节点圆点数为行数。

`monaco-diff-view.test.tsx`：`React.lazy` 懒加载——渲染占位（未加载前显示 loading），断言不因 monaco 缺失崩溃（jsdom 下 monaco 的 loader 用 mock 或依赖注入；实现中提供 `loader` prop 可注入）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/ui test` → FAIL（模块缺失）。

- [ ] **Step 3: 实现四个组件**

`virtual-list.tsx`（要点）：

```tsx
/** 固定行高虚拟列表：只渲染可视窗口（含 overscan），支撑万级提交图滚动 */
import { useMemo, useRef, useState, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  height: number;
  renderRow: (item: T, index: number) => ReactNode;
  overscan?: number;
}

export function VirtualList<T>({ items, rowHeight, height, renderRow, overscan = 5 }: VirtualListProps<T>): ReactNode {
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  const visible = useMemo(() => items.slice(start, end), [items, start, end]);
  return (
    <div style={{ height, overflowY: 'auto' }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {visible.map((item, i) => (
          <div key={start + i} style={{ position: 'absolute', top: (start + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}>
            {renderRow(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

`graph-canvas.tsx`：props `{ rows, rowHeight, laneWidth }`——每个 LayoutRow 画圆点（cx=(lane+0.5)*laneWidth, cy=row*rowHeight+rowHeight/2）+ 每条 EdgeSegment 画 `<line>`（fromLane 起点 → toLane 终点，折线简化为两段 line）。`monaco-diff-view.tsx`：`React.lazy(() => import('./monaco-lazy'))`，fallback 为加载占位；`monaco-lazy.tsx` 内 `import * as monaco from 'monaco-editor'` 并 `loader` 注入点。`empty-state.tsx`：antd `Empty` 包装。

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @rebased/ui test` 全绿 → typecheck/format 绿。

```powershell
git add packages/client/ui
git commit -m "feat(ui): base 组件（虚拟列表/图画布/Monaco 懒加载/空态）"
```

---

### Task 3: ui domain 组件（CommitGraph / RepoStatusBar / DiffViewer / CommitDetailsPanel）+ graph-layout 导出

**Files:**
- Create: `packages/client/ui/src/domain/commit-graph.tsx`、`repo-status-bar.tsx`、`diff-viewer.tsx`、`commit-details-panel.tsx` + 测试
- Modify: `packages/client/ui/src/index.ts`（导出 domain + graph-layout）

**Interfaces:**
- Consumes: `buildLayout`/`mapRowsToVisible`（graph-layout）；`VirtualList`/`GraphCanvas`（base）；`CommitInfo`/`RepoStatus`/`FileVersions`（contracts）。
- Produces: `CommitGraph({ commits, onSelect })`（layout 计算 + 行渲染 + 选中回调）；`RepoStatusBar({ status })`（分支名 + ahead/behind 圆点徽标 + tooltip）；`DiffViewer({ versions, staged, onToggleStaged, ignoreWhitespace, onToggleWhitespace })`（MonacoDiffView 包装 + 模式切换）；`CommitDetailsPanel({ commit })`（UX 对齐 #1 字段集：短 hash+复制、作者、日期、加粗 subject、分支/标签 chips、父链接）。

- [ ] **Step 1: 写失败测试**

`commit-graph.test.tsx`：给定 3 提交（含 merge），渲染行数 = 3；点击行触发 onSelect(hash)。`repo-status-bar.test.tsx`：ahead/behind 非零时渲染徽标（`data-testid="incoming"/"outgoing"`），全零不渲染徽标。`diff-viewer.test.tsx`：模式切换按钮存在、staged 切换回调触发。`commit-details-panel.test.tsx`：渲染短 hash、作者、subject、refs chips、父链接；复制按钮存在。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/ui test` → FAIL。

- [ ] **Step 3: 实现组件**

`commit-graph.tsx`（要点：graph-layout 接线）：

```tsx
/** 提交图：graph-layout 布局 + 虚拟滚动渲染 + 选中回调 */
import { useMemo } from 'react';
import type { CommitInfo } from '@rebased/contracts';
import { buildLayout, mapRowsToVisible, type LayoutCommit } from '../graph-layout';
import { VirtualList } from '../base/virtual-list';
import { GraphCanvas } from '../base/graph-canvas';

export interface CommitGraphProps {
  commits: CommitInfo[];
  onSelect?: (hash: string) => void;
  height?: number;
}

export function CommitGraph({ commits, onSelect, height = 480 }: CommitGraphProps): React.ReactNode {
  const layoutCommits: LayoutCommit[] = useMemo(
    () => commits.map((c) => ({ hash: c.hash, parents: c.parents, refs: c.refs })),
    [commits],
  );
  const rows = useMemo(() => buildLayout(layoutCommits), [layoutCommits]);
  return (
    <VirtualList
      items={rows}
      rowHeight={24}
      height={height}
      renderRow={(row, index) => (
        <div
          style={{ display: 'flex', cursor: onSelect ? 'pointer' : undefined }}
          onClick={() => onSelect?.(row.commit.hash)}
        >
          <GraphCanvas rows={rows.slice(Math.max(0, index - 1), index + 2)} rowHeight={24} laneWidth={18} />
          <span style={{ flex: 1 }}>{row.commit.hash.slice(0, 7)}</span>
        </div>
      )}
    />
  );
}
```

`repo-status-bar.tsx`（UX 对齐 #5：圆点徽标 + tooltip，0 不显示）：antd `Tag`/`Tooltip`；incoming 蓝 `#389FD6`、outgoing 绿 `#59A869`；tooltip 文本 "N incoming and M outgoing commits"。`diff-viewer.tsx`（UX 对齐 #4：默认并排；忽略空白开关）：antd `Segmented`（并排/行内）+ `Switch`（忽略空白）+ MonacoDiffView。`commit-details-panel.tsx`（UX 对齐 #1）：短 hash + Copy 按钮、author、dateIso 格式化、加粗 message 首行、refs chips（antd Tag，分支/标签分组）、parents 链接列表。

graph-layout 导出：`index.ts` 追加 `export * from './graph-layout';`

- [ ] **Step 4: 运行确认通过 + 提交**

Run: ui 全绿 → typecheck/format 全仓绿。

```powershell
git add packages/client/ui
git commit -m "feat(ui): domain 组件（提交图/状态条/diff 查看器/详情面板）与 graph-layout 导出"
```

---

### Task 4: ui composite 页面（RepoPage / LogPage / DiffPage）

**Files:**
- Create: `packages/client/ui/src/composite/repo-page.tsx`、`log-page.tsx`、`diff-page.tsx` + 测试
- Modify: `packages/client/ui/src/index.ts`

**Interfaces:**
- Consumes: domain 组件 + base；`RepoInfo`/`RepoStatus`/`CommitInfo`/`LogPage` 等 contracts 类型（**页面 props 由调用方注入 hooks 数据，ui 不直接调 client**——web-next 与 web-koa 各自的容器组件接 hooks）。
- Produces: `RepoPage({ repos, onOpen })`（最近列表：显示名三级回退、路径副文本、移除按钮带确认——UX 对齐 #3；打开表单）；`LogPage({ repoName, status, commits, onSelectCommit, selectedCommit })`；`DiffPage({ versions, file, staged, onToggleStaged, onToggleWhitespace })`。

- [ ] **Step 1: 写失败测试**

`repo-page.test.tsx`：渲染最近仓库列表（显示名/路径）；点击移除弹确认；打开表单提交回调。`log-page.test.tsx`：渲染 CommitGraph + RepoStatusBar + 选中后 CommitDetailsPanel。`diff-page.test.tsx`：DiffViewer 渲染 + staged 切换。

- [ ] **Step 2: 运行确认失败 → Step 3 实现 → Step 4 绿 + 提交**

`repo-page.tsx` 显示名规则（UX 对齐 #3）：`name` 来自 repo 注册（settings 已有 name）；路径副文本：`path` 相对 `homedir()` 时显示 `~/…`（工具函数 `relativeToHome` 放 `src/composite/repo-page-utils.ts` 并单测）。移除：antd `Popconfirm`。

```powershell
git commit -m "feat(ui): composite 页面（仓库/日志/差异）"
```

---

### Task 5: client hooks（SWR + SSE）

**Files:**
- Create: `packages/client/client/src/http.ts`、`repos.ts`、`log.ts`、`diff.ts`、`settings.ts`、`events.ts`（hooks 按端点分组）+ 测试
- Modify: `packages/client/client/src/index.ts`、`packages/client/client/package.json`（devDeps 加 `vitest` 已有）

**Interfaces:**
- Consumes: contracts 类型与 schema。
- Produces: `useRecentRepos()` / `useOpenRepo()`（mutation）；`useRepoStatus(repoId)`；`useLogPage(repoId, query)`；`useLogStream(repoId)`（SSE 增量：暴露 `commits` 与 `connected`）；`useFileDiff(repoId, file, staged)`；`useDiffStream(repoId, file)`；`useRepoEvents(repoId)`（订阅 repo.state-changed → `onChange` 回调）；`useSettings()`。SSE 实现 `subscribeSse(url, { onEvent, signal })`（`EventSource` 或 fetch 流；本地应用用 fetch + ReadableStream 解析 `data:` 帧更可控——**选 fetch 流**，与取消链路一致）。

- [ ] **Step 1: 写失败测试（mock fetch / mock 流）**

`http.ts` 的 `getJson`/`postJson` 用 `vi.stubGlobal('fetch', ...)` 断言 URL/方法/错误映射（非 2xx → ServiceError code）。`log.ts` 的 `useLogStream` 用可控异步迭代器 mock `subscribeSse`，断言增量追加与断开清理。`events.ts` 的 `useRepoEvents` 断言事件回调。

- [ ] **Step 2: 运行确认失败 → Step 3 实现 → Step 4 绿 + 提交**

`http.ts` 要点：

```ts
/** 客户端 HTTP：同源 /api；非 2xx 解析 {error:{code,message}} → ServiceError */
import { ServiceError } from '@rebased/contracts';

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ServiceError((body?.error?.code ?? 'GIT_ERROR') as never, body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

`subscribeSse`（fetch 流解析 `data: ` 帧）：

```ts
export async function subscribeSse(url: string, onEvent: (event: { type: string; payload: unknown }) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new ServiceError('GIT_ERROR', `SSE ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame.replace(/^data: /, '');
        if (data) onEvent(JSON.parse(data) as { type: string; payload: unknown });
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

hooks 用 SWR（`useSWR`/`useSWRMutation`），SSE hooks 用 `useEffect` + 上述 subscribe（`useLogStream` 维护 `commits` state 增量追加）。

```powershell
git add packages/client/client
git commit -m "feat(client): SWR/SSE hooks（repos/status/log/diff/settings/events）"
```

---

### Task 6: web-next 壳与 REST 路由

**Files:**
- Create: `apps/web-next/app/layout.tsx`、`app/page.tsx`、`app/repos/[repoId]/page.tsx`、`app/repos/[repoId]/diff/page.tsx`（或路由内 tab）、`app/api/repos/route.ts`、`app/api/repos/open/route.ts`、`app/api/repos/[repoId]/status/route.ts`、`app/api/repos/[repoId]/log/route.ts`、`app/api/repos/[repoId]/diff/route.ts`、`app/api/settings/route.ts`（GET/PUT）
- Create: `apps/web-next/src/server-context.ts`（路由层共享的 repoId→path 解析 + 错误映射工具）
- Test: `apps/web-next/src/routes.test.ts`（构造 Request 调 route 函数）

**Interfaces:**
- Consumes: api（`openRepo`/`getRepoById`/`getRepoStatus`/`getLogPage`/`getFileDiff`/`getFileVersions`/`getSettings`/`updateSettings`/`toServiceError`）；contracts schema（`openRepoBodySchema`/`logQuerySchema`/`diffQuerySchema`/`settingsPatchSchema`）；ui composite 页面 + client hooks。
- Produces: REST 端点（三件套）；`handleApiError(error, init?)` 工具（toServiceError → 状态码 + JSON body）。

- [ ] **Step 1: 写失败测试（routes.test.ts）**

```ts
import { describe, expect, it } from 'vitest';
import { GET as getLog } from '../app/api/repos/[repoId]/log/route';
import { GET as getStatus } from '../app/api/repos/[repoId]/status/route';

describe('web-next REST 路由', () => {
  it('log 端点：无 repoId 参数返回 400 INVALID_QUERY', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/x/log'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
  // 注：真实仓库路径经 getRepoById——无注册仓库时返回 404 REPO_NOT_FOUND（getRepoById 抛错 → 映射）
  it('status 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getStatus(new Request('http://localhost/api/repos/nope/status'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行确认失败（vitest 需配置 jsdom/node——web-next vitest.config.ts 建 node 环境，include apps/web-next/src/**）→ Step 3 实现 → Step 4 绿 + 提交**

`src/server-context.ts`（路由三件套骨架）：

```ts
/** 路由层共享：错误映射 + repoId 解析（三件套的后两环） */
import { getRepoById } from '@rebased/api';
import { httpStatusFor } from '@rebased/contracts';
import { toServiceError } from '@rebased/api';

export async function handleApiError(error: unknown, init?: ResponseInit): Promise<Response> {
  const serviceError = toServiceError(error);
  return Response.json(
    { error: { code: serviceError.code, message: serviceError.message, ...(serviceError.context ? { context: serviceError.context } : {}) } },
    { ...init, status: httpStatusFor(serviceError.code) },
  );
}

export function resolveRepo(repoId: string): string {
  return getRepoById(repoId).path; // REPO_NOT_FOUND 抛错由调用方 handleApiError 兜底
}
```

路由示例 `app/api/repos/[repoId]/log/route.ts`：

```ts
/** GET /api/repos/:repoId/log —— zod 校验查询 → 调 api → 错误映射 */
import { getLogPage } from '@rebased/api';
import { logQuerySchema } from '@rebased/contracts';
import { handleApiError, resolveRepo } from '../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const query = logQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const page = await getLogPage(resolveRepo(repoId), query);
    return Response.json(page);
  } catch (error) {
    return handleApiError(error);
  }
}
```

（其余端点同构：status 无参、diff 用 diffQuerySchema + getFileVersions（UX 对齐 Monaco 需要）或 getFileDiff、open 用 POST + openRepoBodySchema、settings GET/PUT。）

`app/layout.tsx`：SSR 壳——antd `ConfigProvider`（`theme.darkAlgorithm`）+ `App` 包装 + 全局样式；`app/page.tsx`：`'use client'` 容器组件（client hooks 接 RepoPage）；`app/repos/[repoId]/page.tsx`：LogPage 容器（useLogPage + useLogStream + useRepoStatus + useRepoEvents → 注入）；diff 页面同构。

```powershell
git add apps/web-next
git commit -m "feat(web-next): 壳与 REST 路由（三件套）"
```

---

### Task 7: web-next SSE 路由（log/stream、diff/stream、events）+ 取消

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/log/stream/route.ts`、`diff/stream/route.ts`、`events/route.ts`
- Test: `apps/web-next/src/sse.test.ts`

**Interfaces:**
- Consumes: `streamLogEvents`/`streamDiffEvents`/`watchRepoStatus`（api）；`serializeSseEvent`（contracts）。
- Produces: SSE 端点——`ReadableStream.from(映射 serializeSseEvent)`；`request.signal` → api opts.signal（取消链路）；流错误呈现（终审前置：streamLogEvents 抛错 → 流内发 error 事件帧后关闭，不崩响应）。

- [ ] **Step 1: 写失败测试（sse.test.ts）**

真实临时仓库：注册 repo（REBASED_CONFIG_DIR 隔离）→ GET log/stream → 读 Response.body 首帧断言 `data: {"type":"log.line"`；events 端点首帧 `repo.state-changed`；`request.signal` abort 后流关闭（构造带 AbortController 的 Request）。

- [ ] **Step 2: RED → Step 3 实现 → Step 4 绿 + 提交**

`log/stream/route.ts`：

```ts
/** GET /api/repos/:repoId/log/stream —— SSE：log.line 增量；断开 → AbortController → 取消 git 进程 */
import { streamLogEvents } from '@rebased/api';
import { serializeSseEvent } from '@rebased/contracts';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const repoPath = resolveRepo(repoId);
    const stream = ReadableStream.from(
      (async function* () {
        try {
          for await (const event of streamLogEvents(repoPath, { limit: 50, skip: 0 }, { signal: req.signal })) {
            yield serializeSseEvent(event);
          }
        } catch (error) {
          // 流错误呈现（终审前置）：发 error 帧后结束，不崩响应
          yield serializeSseEvent({ type: 'stream.error', payload: { message: (error as Error).message } });
        }
      })(),
    );
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
```

（diff/stream 同构：diffQuerySchema + streamDiffEvents + file 校验已由 api assertValidQuery 覆盖。events 用 watchRepoStatus + req.signal；其 getRepoStatus 抛错冒泡 → 流内 error 帧。）

```powershell
git add apps/web-next
git commit -m "feat(web-next): SSE 路由（log/diff 增量与状态推送，含取消与流错误）"
```

---

### Task 8: web-koa 服务端（app/routes/middleware）

**Files:**
- Create: `apps/web-koa/src/app.ts`、`src/routes/repos.ts`、`src/middleware/error.ts`、`src/server-context.ts`
- Test: `apps/web-koa/src/app.test.ts`（`app.callback()` + supertest 式 fetch 直调）

**Interfaces:**
- Consumes: 与 web-next 相同的 api/contracts；`koa`/`@koa/router`/`@koa/bodyparser`/`koa-static`。
- Produces: Koa 应用——REST 端点清单与 web-next 完全对称；SSE 端点写 `ctx.res`；错误中间件统一 `{error:{...}}`。

- [ ] **Step 1: 写失败测试**

`app.test.ts`：注册临时仓库 → `GET /api/repos/:id/status` 200 断言形状；`POST /api/repos/open` 空 path 400；未注册 id 404；SSE 端点首帧（supertest 式：直接调 `app.callback()` 处理 `http.request` 模拟或 Koa 的 `ctx` 直测——用 `http` 模块起 ephemeral 端口实测最稳）。

- [ ] **Step 2: RED → Step 3 实现 → Step 4 绿 + 提交**

`src/middleware/error.ts`：

```ts
/** 统一错误中间件：任何抛错 → {error:{code,message,context?}} + httpStatusFor */
import type { Middleware } from 'koa';
import { httpStatusFor } from '@rebased/contracts';
import { toServiceError } from '@rebased/api';

export const errorHandler: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    const serviceError = toServiceError(error);
    ctx.status = httpStatusFor(serviceError.code);
    ctx.body = { error: { code: serviceError.code, message: serviceError.message, ...(serviceError.context ? { context: serviceError.context } : {}) } };
  }
};
```

`src/routes/repos.ts`：`@koa/router` 同清单（`GET /api/repos`、`POST /api/repos/open`、`/api/repos/:repoId/status|log|diff|log/stream|diff/stream|events`、`/api/settings`）；SSE 端点：`ctx.status = 200; ctx.set({...}); ctx.req.on('close', () => ac.abort()); for await (event of ...) ctx.res.write(serializeSseEvent(event))`，finally `ctx.res.end()`。`src/app.ts`：`new Koa()` + errorHandler + bodyparser + routes + `koa-static('public')`（存在时）+ 启动日志。`src/server-context.ts` 与 web-next 同构（resolveRepo/handleApiError——Koa 版返回 void 直接设 ctx，或复用纯函数）。

```powershell
git add apps/web-koa
git commit -m "feat(web-koa): Koa 服务端（对称端点清单 + 统一错误 + SSE）"
```

---

### Task 9: web-koa Vite SPA 组装（页面挂载 + 构建验证）

**Files:**
- Modify: `apps/web-koa/src/main.tsx`（挂载真实页面容器：Router + RepoPage/LogPage/DiffPage 容器组件，复用 client hooks）
- Create: `apps/web-koa/src/pages.tsx`（容器组件：hooks 注入 ui 页面——与 web-next 容器同构但用 react-router）
- Modify: `apps/web-koa/package.json`（deps 加 react/react-dom/swr/@rebased/ui/@rebased/client、react-router-dom）

**Interfaces:**
- Consumes: ui composite + client hooks；react-router（BrowserRouter，`/` 与 `/repos/:repoId`）。

- [ ] **Step 1: 依赖与路由骨架**

`pnpm --filter @rebased/web-koa add react@19.2.7 react-dom@19.2.7 react-router-dom@^7 @rebased/ui@workspace:* @rebased/client@workspace:* swr`（或手改 package.json + install）。

- [ ] **Step 2: main.tsx + pages.tsx**

```tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfigProvider, theme, App as AntApp } from 'antd';
import { ReposPage } from './pages';
import { RepoPage } from './pages/repo';

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <AntApp>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ReposPage />} />
          <Route path="/repos/:repoId" element={<RepoPage />} />
        </Routes>
      </BrowserRouter>
    </AntApp>
  </ConfigProvider>,
);
```

`pages/repo.tsx`：`useParams()` 取 repoId → `useRepoStatus/useLogPage/useLogStream/useRepoEvents` → 注入 `<LogPage …>`（与 web-next 容器同构，hooks 通用）。

- [ ] **Step 3: 构建与联调验证**

Run: `pnpm --filter @rebased/web-koa build`（vite build → public/）→ `tsx src/app.ts`（3031）→ 浏览器验证 `http://localhost:3031` 页面可开仓库（或 curl public 产物 + `curl localhost:3031/api/repos`）。
Run: `pnpm --filter @rebased/web-next dev`（3030）→ `curl http://localhost:3030/api/repos`。

- [ ] **Step 4: 提交**

```powershell
git add apps/web-koa apps/web-next
git commit -m "feat(web-koa): Vite SPA 组装（react-router + 共享 ui/client）"
```

---

### Task 10: UX 对齐 6 项核查、全链验收与 AGENT.md 更新

**Files:**
- Modify: `packages/client/ui/src/composite/*`（如有缺项补齐）、`AGENT.md`（命令表与路径别名更新）、根 `package.json`（dev 脚本并行说明可选）

**Interfaces:**
- Consumes: 全部前序产物。

- [ ] **Step 1: UX 对齐 6 项逐项核查（对照 spec §6）**

1. 提交详情面板字段集（Task 3 已含：短 hash+复制/作者/日期/subject/chips/父链接）→ 核查测试断言完整
2. CommitGraph 行默认列 Subject+Author+Date、tag chips 默认关（Task 3 CommitGraph 行渲染补 Author/Date 列 + refs chips 按 type 分组、tag 关）
3. RepoPage 最近列表显示名三级回退 + 路径副文本 + 移除确认（Task 4 已含，核查 `relativeToHome`）
4. DiffPage 默认并排 + 忽略空白开关（Task 3/4 已含）
5. RepoStatusBar 徽标形态（Task 3 已含：蓝/绿圆点 + tooltip、0 不显示）
6. 默认值文档化（logInEditor=true、word diff）→ AGENT.md 或 README 记录

- [ ] **Step 2: 全链验收（spec §7 验收标准 6 条）**

```powershell
pnpm typecheck   # 全仓
pnpm format
pnpm test        # 全链（contracts 7 + core 22 + api 23 + ui ≈22+新 + client + apps ≈ 110+）
```

手动验收（记录到报告）：
1. `pnpm --filter @rebased/web-next dev` → http://localhost:3030 打开仓库 → CommitGraph 真图渲染
2. SSE 增量：另开终端提交一条 → 图顶部出现新行；关页面 → 无残留 git 进程（`tasklist | findstr git` 抽查）
3. DiffPage：并排/行内切换、忽略空白开关、staged 切换正确
4. RepoStatusBar 徽标与 /events 推送刷新
5. 详情面板字段完整
6. `pnpm --filter @rebased/web-koa dev`（3031）+ `pnpm --filter @rebased/web-koa dev:web`（5173）同验

- [ ] **Step 3: AGENT.md 更新**

命令表补 `pnpm dev` 说明（并行起 web-next 3030 与 web-koa 3031 + Vite 5173）；路径别名行 `@/ → packages/web/src/` 更新为各包自含（web-next 内 `@/*` 指向 `apps/web-next/*`）。

- [ ] **Step 4: 提交**

```powershell
git add packages/client/ui AGENT.md apps
git commit -m "feat: UX 对齐核查与全链验收，AGENT.md 命令更新"
```

**Plan 2b 完成标准**：3030/3031 均可访问并完成「打开仓库 → 图渲染 → diff 对比」闭环；SSE 增量与断开取消验证通过；全链测试绿；UX 6 项核查通过。完成后与用户确认分支合并决策。

---

## 自审记录（本计划 vs spec）

- spec §2 结构/依赖/运行形态 → Task 1、Task 6-9 ✓
- spec §3 graph-layout → Plan 2a 已交付，Task 3 接线 ✓
- spec §4 端点/SSE/取消/events → Task 6-8（含 SSE 流错误、rev:'' 404 映射前置项：rev:'' 404 由路由层对 GitExitError 特判或 api 层映射——Task 6 server-context 的 handleApiError 加 rev 场景说明；若实现中发现 api 层更优则按裁定调整）✓
- spec §5 客户端层 → Task 2-5 ✓
- spec §6 UX 对齐 6 项 → Task 3/4/10 ✓
- spec §7 验收 → Task 10 ✓
- 终审前置清单：SSE 流错误（Task 7）、ui index 导出 graph-layout（Task 3）、rows-mapping 拷贝（Task 3 CommitGraph 使用 mapRowsToVisible 时拷贝——实现中显式 `[...rows]` 或注释）、增量布局缓存（Task 3 useMemo 全量重算 + 注记）、file 校验（api 层已有，路由层依赖 schema）✓
- 占位符扫描：无 TBD；Task 2-4 组件实现为最小可用形态（接口 + 测试契约完整），Task 6-9 路由/SSE 代码完整
- 类型一致性：`CommitGraph` props（Task 3 定义，Task 4/6/9 使用）、`subscribeSse` 签名（Task 5 定义，Task 7 无直接依赖——路由层是服务端，client 的 SSE 是浏览器端消费）、`handleApiError`（Task 6 定义，Task 7 使用）一致
