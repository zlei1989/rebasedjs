# Rebased.js Plan 2a：服务端增补与 graph-layout 移植 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Plan 2 所需的服务端能力（取消链路闭环、readFileAtRev、getFileVersions、events.ts、signal 透传），并把 Java 版 VCS Log 图布局算法移植为纯 TS 模块 `graph-layout`，行为经 Java testData 等价验证。

**Architecture:** 延续既有分层：core（引擎原语）→ api（功能服务层，一个功能一个文件）→ contracts（跨端契约）。graph-layout 落在 `packages/client/ui/src/graph-layout/`（纯函数、不 import React），输入 `LayoutCommit[]` 输出 `LayoutRow[]`，等价性由 Java `platform/vcs-log/graph/testData` 转制的 vitest 夹具保证。本计划产出全部可经 `pnpm --filter ... test` 独立验证，不依赖 UI 与 apps。

**Tech Stack:** TypeScript 5 strict、vitest（node env，core/api 已有 testTimeout 30000）、真实 git CLI fixture、JD 镜像（`pnpm.overrides vite 7.3.6` 既有）。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-apps-assembly-design.md`（§3 graph-layout、§4.2 events.ts、§4.3 取消链路、§5.3 readFileAtRev/getFileVersions）。Java 参照源码：`D:\zhanglei1120\Github\rebased\platform\vcs-log\graph\`。

## Global Constraints

- `core`/`api` 禁 import next/koa/react/react-dom（eslint 边界）；`graph-layout` 不 import React、不 import 任何 apps。
- api 功能服务层一个功能一个文件；新增功能文件经 `index.ts` 导出。
- core 测试用真实 git CLI + 临时仓库 fixture，不 mock git。
- 注释风格：JSDoc 中文，先说"做什么"再说"怎么做"；graph-layout 移植文件头保留 JetBrains 版权声明（Apache-2.0）。
- 质量门：`pnpm typecheck` → `pnpm format` → `pnpm test` 全绿（本计划完成后全链 44 用例：contracts 7 + core 19 + api 18 + graph-layout ≥6）。
- 错误形状 `{error:{code,message,context?}}`；取消语义：abort → `GitExitError`(130)，与 runGit 对齐（Ruling 15 家族）。
- 分支 `feat/server-core`（HEAD 98ced26）；不碰 apps 与 client 包（Plan 2b 职责）。
- 本计划无新依赖、不需要 pnpm install（若个别包缺依赖再上报）。

---

### Task 1: core —— streamGit 取消对齐（aborted 语义 + break 杀进程 + 预检）

**Files:**
- Modify: `packages/server/core/src/exec.ts`（streamGit 函数体）
- Test: `packages/server/core/src/exec.test.ts`（新增 3 个用例）

**Interfaces:**
- Consumes: 现有 `buildArgs`/`killTree`（exec.ts 内部）。
- Produces: `streamGit` 新语义——已中止 signal 预检直接抛 `GitExitError(args, 130, '', '')`；abort 置 `aborted` 标志并杀树；close 后 `aborted || code!==0` 时抛 `GitExitError(args, aborted ? 130 : code ?? 1, '', stderr)`；消费者 break/提前 return 时 finally 里杀子进程并移除监听。

- [ ] **Step 1: 写失败测试（追加到 exec.test.ts）**

```ts
  describe('streamGit 取消语义', () => {
    it('已中止的 signal 预检：不启动进程直接抛 130', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      const ac = new AbortController();
      ac.abort();
      const collect = async (): Promise<string> => {
        let out = '';
        for await (const c of streamGit(['log'], { cwd: repo, signal: ac.signal })) out += c;
        return out;
      };
      await expect(collect()).rejects.toMatchObject({ name: 'GitExitError', exitCode: 130 });
    });

    it('进行中 abort：以 130 拒绝', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      // upload-pack 读取 stdin，天然阻塞（无网络依赖）
      const ac = new AbortController();
      const collect = async (): Promise<string> => {
        let out = '';
        for await (const c of streamGit(['upload-pack', repo], { cwd: repo, signal: ac.signal })) out += c;
        return out;
      };
      const p = collect();
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'GitExitError', exitCode: 130 });
    });

    it('消费者 break：生成器干净结束（finally 杀进程，无悬挂）', async () => {
      const repo = createTmpRepo();
      dirs.push(repo);
      const iter = streamGit(['upload-pack', repo], { cwd: repo });
      const first = await iter.next(); // 进程已启动并阻塞
      expect(first.done).toBe(false);
      await iter.return(undefined); // break 语义：finally 清理后结束
      // 仓库未被锁：后续 git 命令仍可执行
      await expect(runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo })).resolves.toMatchObject({ stdout: 'true\n' });
    });
  });
```

（import 行追加 `streamGit`——Task 4 已导出。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- exec.test.ts`
Expected: 新 3 用例 FAIL（现有 streamGit 无预检、abort 后 close 0 会正常完成、break 不杀进程）。

- [ ] **Step 3: 重写 streamGit**

```ts
/** 流式执行 git（大输出场景：log 图、diff），逐块产出 stdout 文本。
 *  取消语义与 runGit 对齐：abort 后绝不正常完成，统一以 exitCode 130 拒绝；
 *  消费者提前 break 时杀子进程树并清理监听，避免悬挂。 */
export async function* streamGit(args: string[], opts: { cwd: string; signal?: AbortSignal }): AsyncIterable<string> {
  // 预检：signal 已中止则不启动进程
  if (opts.signal?.aborted) throw new GitExitError(args, 130, '', '');
  const child = spawn('git', buildArgs(args), {
    cwd: opts.cwd,
    env: { ...process.env, LC_ALL: 'C' },
    windowsHide: true,
  });
  let stderr = '';
  let aborted = false;
  const onAbort = (): void => {
    aborted = true;
    // 进程已退出则绝不动其 pid（Windows PID 复用风险）
    if (child.exitCode === null) killTree(child.pid!);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const closed: Promise<number | null> = new Promise((resolve) => child.on('close', resolve));
  child.stdout.setEncoding('utf8');

  let completed = false;
  try {
    for await (const chunk of child.stdout) {
      yield chunk;
    }
    completed = true;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    // 仅消费者提前退出（break/throw）时杀进程；自然结束不动已退出 pid
    if (!completed && child.exitCode === null) killTree(child.pid!);
  }
  const code = await closed;
  if (aborted || code !== 0) {
    throw new GitExitError(args, aborted ? 130 : (code ?? 1), '', stderr);
  }
}
```

- [ ] **Step 4: 运行确认通过 + 全量**

Run: `pnpm --filter @rebased/core test -- exec.test.ts` → 新 3 用例 PASS；`pnpm --filter @rebased/core test` → 全量 19/19（原 16 + 3）。
另跑 `pnpm --filter @rebased/core typecheck` 与 `format`（format 不改文件）。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/core
git commit -m "feat(core): streamGit 取消语义对齐 runGit（130/预检/break 杀进程）"
```

---

### Task 2: core —— readFileAtRev 原语

**Files:**
- Create: `packages/server/core/src/content.ts` + `content.test.ts`
- Modify: `packages/server/core/src/index.ts`（导出 readFileAtRev）

**Interfaces:**
- Consumes: `runGit`（`./exec`）。
- Produces: `readFileAtRev(repoPath, opts: { file: string; rev?: string }): Promise<string>`——`rev` 为提交/ref 时经 `git show <rev>:<file>`；`rev === ''` 表示暂存区（`git show :<file>`）；省略读工作区文件。

- [ ] **Step 1: 写失败测试**

```ts
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileAtRev } from './content';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('readFileAtRev', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('三态读取：工作区 / HEAD / 暂存区', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');          // 工作区 v2
    execFileSync('git', ['-C', repo, 'add', '.']);     // 暂存区 v2
    writeFileSync(join(repo, 'a.txt'), 'v3');          // 工作区 v3
    expect(await readFileAtRev(repo, { file: 'a.txt' })).toBe('v3');
    expect(await readFileAtRev(repo, { file: 'a.txt', rev: 'HEAD' })).toBe('v1');
    expect(await readFileAtRev(repo, { file: 'a.txt', rev: '' })).toBe('v2');
  });

  it('不存在的 rev/文件抛 GitExitError', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await expect(readFileAtRev(repo, { file: 'a.txt', rev: 'no-such-ref' })).rejects.toMatchObject({ name: 'GitExitError' });
    await expect(readFileAtRev(repo, { file: 'missing.txt', rev: 'HEAD' })).rejects.toMatchObject({ name: 'GitExitError' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/core test -- content.test.ts` → FAIL（找不到模块）。

- [ ] **Step 3: 实现 content.ts**

```ts
/** 文件内容原语：工作区直读、指定 rev 经 git show、'' 表示暂存区。
 *  仅面向文本文件（P1 约定）；二进制文件返回原始字节转 utf8，上层按需处理。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './exec';

export async function readFileAtRev(repoPath: string, opts: { file: string; rev?: string }): Promise<string> {
  if (opts.rev === undefined) {
    return readFileSync(join(repoPath, opts.file), 'utf8');
  }
  const { stdout } = await runGit(['show', `${opts.rev}:${opts.file}`], { cwd: repoPath });
  return stdout;
}
```

index.ts 追加：`export { readFileAtRev } from './content';`

- [ ] **Step 4: 运行确认通过 + 全量**

Run: `pnpm --filter @rebased/core test` → 21/21（原 19 + 2）；typecheck/format 绿。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/core
git commit -m "feat(core): readFileAtRev 文件内容原语（工作区/HEAD/暂存区）"
```

---

### Task 3: contracts FileVersions + api getFileVersions + signal 透传

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`（新增 FileVersions）
- Modify: `packages/server/api/src/diff.ts`（getFileVersions + getFileDiff/streamDiffEvents 加 `opts?: { signal?: AbortSignal }`）
- Modify: `packages/server/api/src/log.ts`（getLogPage/streamLogEvents 加 `opts?: { signal?: AbortSignal }`，透传 core streamLog）
- Modify: `packages/server/api/src/index.ts`（导出 getFileVersions）
- Test: `packages/server/api/src/diff.test.ts`（+2 用例）、`log.test.ts`（+1 用例）

**Interfaces:**
- Consumes: `readFileAtRev`/`collectFileDiff`/`streamFileDiff`/`streamLog`（core）。
- Produces: `FileVersions { before: string; after: string }`；`getFileVersions(repoPath, query, opts?): Promise<FileVersions>`（三态映射见 spec §5.3，沿用 assertValidQuery 成对校验）；`getFileDiff`/`streamDiffEvents`/`getLogPage`/`streamLogEvents` 第二参后新增可选 `opts`。

- [ ] **Step 1: 写失败测试**

`diff.test.ts` 追加：

```ts
  it('getFileVersions 三态映射两侧内容', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    writeFileSync(join(repo, 'a.txt'), 'v3');
    const worktree = await getFileVersions(repo, { file: 'a.txt', staged: false });
    expect(worktree).toEqual({ before: 'v1', after: 'v3' });
    const staged = await getFileVersions(repo, { file: 'a.txt', staged: true });
    expect(staged).toEqual({ before: 'v1', after: 'v2' });
    const ranged = await getFileVersions(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD' });
    expect(ranged).toEqual({ before: 'v1', after: 'v1' });
  });

  it('getFileVersions 沿用成对校验', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileVersions(repo, { file: 'a.txt', from: 'HEAD', staged: false }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
```

`log.test.ts` 追加：

```ts
  it('streamLogEvents 支持 signal 取消（透传 core，abort 后拒绝）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'only');
    const ac = new AbortController();
    const collect = async (): Promise<unknown[]> => {
      const events = [];
      for await (const e of streamLogEvents(repo, { limit: 10, skip: 0 }, { signal: ac.signal })) events.push(e);
      return events;
    };
    const p = collect();
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'GitExitError', exitCode: 130 });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- diff.test.ts log.test.ts` → 新 3 用例 FAIL。

- [ ] **Step 3: 实现**

`contracts/src/domain.ts` 追加：

```ts
/** 单文件两侧全文（Monaco DiffEditor 用）：before=旧版本、after=新版本 */
export interface FileVersions {
  before: string;
  after: string;
}
```

`api/src/diff.ts` 追加（getFileDiff/streamDiffEvents 签名改 `(repoPath, query, opts?: { signal?: AbortSignal })`，内部透传 `opts?.signal`）：

```ts
/** 单文件两侧全文：staged→HEAD vs 暂存区；工作区→HEAD vs 工作区；from/to→两侧版本。 */
export async function getFileVersions(repoPath: string, query: DiffQuery, opts: { signal?: AbortSignal } = {}): Promise<FileVersions> {
  assertValidQuery(query);
  if (query.from !== undefined && query.to !== undefined) {
    const [before, after] = await Promise.all([
      readFileAtRev(repoPath, { file: query.file, rev: query.from }),
      readFileAtRev(repoPath, { file: query.file, rev: query.to }),
    ]);
    return { before, after };
  }
  const before = await readFileAtRev(repoPath, { file: query.file, rev: 'HEAD' });
  const after = query.staged
    ? await readFileAtRev(repoPath, { file: query.file, rev: '' })
    : await readFileAtRev(repoPath, { file: query.file });
  return { before, after };
}
```

（import 补 `readFileAtRev` from '@rebased/core'、`FileVersions` type；signal 参数在 from/to 分支对 readFileAtRev 不适用则仅透传给 getFileDiff/streamDiffEvents 的 core 调用。）

`api/src/log.ts`：两函数签名改 `(repoPath, query, opts?: { signal?: AbortSignal })`，内部 streamLog 调用补 `signal: opts?.signal`。

`api/src/index.ts`：diff 行改 `export { getFileDiff, getFileVersions, streamDiffEvents } from './diff';`

- [ ] **Step 4: 运行确认通过 + 全量**

Run: `pnpm --filter @rebased/api test` → 19/19（原 16 + 3：diff +2、log +1）；typecheck/format 绿。core 全量仍 21/21。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/contracts packages/server/api
git commit -m "feat(api): getFileVersions 两侧全文、FileVersions 契约与 signal 透传"
```

---

### Task 4: api —— events.ts（仓库状态推送）

**Files:**
- Create: `packages/server/api/src/events.ts` + `events.test.ts`
- Modify: `packages/server/api/src/index.ts`

**Interfaces:**
- Consumes: `getRepoStatus`（`./status`）；`RepoStatus`（contracts）。
- Produces: `watchRepoStatus(repoPath, opts?: { intervalMs?: number; signal?: AbortSignal }): AsyncIterable<{ type: 'repo.state-changed'; payload: RepoStatus }>`——首产当前状态，之后每 intervalMs 轮询、仅变化时产事件；signal 中止即结束。

- [ ] **Step 1: 写失败测试**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { watchRepoStatus } from './events';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

async function collect(repo: string, opts: { count: number; intervalMs?: number; signal?: AbortSignal }): Promise<Array<{ type: string; payload: { branch: string | null } }>> {
  const out: Array<{ type: string; payload: { branch: string | null } }> = [];
  for await (const e of watchRepoStatus(repo, opts)) {
    out.push(e);
    if (out.length >= opts.count) break;
  }
  return out;
}

describe('watchRepoStatus', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('首产当前状态，变化后产新事件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const p = collect(repo, { count: 2, intervalMs: 100 });
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(repo, 'a.txt'), 'hello'); // 触发状态变化
    const events = await p;
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('repo.state-changed');
    expect(events[1].payload.branch).toBeTruthy();
  });

  it('signal 中止后生成器结束', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    const p = collect(repo, { count: 100, intervalMs: 50, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const events = await p; // abort 后自然结束，不抛错
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @rebased/api test -- events.test.ts` → FAIL。

- [ ] **Step 3: 实现 events.ts**

```ts
/** 仓库状态推送：轮询 status、仅变化时产 repo.state-changed 事件。
 *  P1 简化（operation.ts 为 P2 的进行中操作状态域，互补）。
 *  事件序：先产当前状态（首帧），之后 diff 比较。 */
import type { RepoStatus } from '@rebased/contracts';
import { getRepoStatus } from './status';

export interface RepoStateEvent {
  type: 'repo.state-changed';
  payload: RepoStatus;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  });
}

function statusEquals(a: RepoStatus, b: RepoStatus): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function* watchRepoStatus(repoPath: string, opts: { intervalMs?: number; signal?: AbortSignal } = {}): AsyncIterable<RepoStateEvent> {
  const intervalMs = opts.intervalMs ?? 2000;
  let last = await getRepoStatus(repoPath);
  yield { type: 'repo.state-changed', payload: last };
  while (!opts.signal?.aborted) {
    try {
      await sleep(intervalMs, opts.signal);
    } catch {
      return; // 中止：结束生成器
    }
    const current = await getRepoStatus(repoPath);
    if (!statusEquals(last, current)) {
      last = current;
      yield { type: 'repo.state-changed', payload: current };
    }
  }
}
```

index.ts 追加：`export { watchRepoStatus } from './events';`

- [ ] **Step 4: 运行确认通过 + 全量**

Run: `pnpm --filter @rebased/api test` → 21/21（19 + 2）；typecheck/format 绿。

- [ ] **Step 5: 提交**

```powershell
git add packages/server/api
git commit -m "feat(api): events 功能文件（轮询式仓库状态推送）"
```

---

### Task 5: graph-layout —— 夹具基建与 buildLayout 核心（lane 分配）

**Files:**
- Create: `packages/client/ui/src/graph-layout/types.ts`、`build-layout.ts`、`build-layout.test.ts`
- Create: `packages/client/ui/src/graph-layout/fixtures/linear.ts`、`merge.ts`（手写规范夹具）
- Create: `packages/client/ui/src/graph-layout/fixtures/java/`（自 Java testData 转制，见 Step 1）

**Interfaces:**
- Consumes: 无（纯函数；不 import React/antd）。
- Produces: `LayoutCommit { hash; parents; refs }`、`EdgeSegment { fromLane; toLane; fromRow; toRow }`、`LayoutRow { commit; lane; edges; color }`、`buildLayout(commits: LayoutCommit[]): LayoutRow[]`——lane 分配语义与 Java `GraphLayoutBuilder.kt`/`GraphLayoutImpl.kt` 一致（边冲突时开新 lane；合并行收拢）。

- [ ] **Step 1: 研读 Java 参照并列出 testData 清单**

```powershell
Get-ChildItem D:\zhanglei1120\Github\rebased\platform\vcs-log\graph\testData -Recurse -File | Select-Object FullName
```

读 `GraphLayoutBuilder.kt`、`GraphLayoutImpl.kt`（lane 分配核心）与 `testData/layoutBuilder/` 下的输入/期望文件。记录到报告：testData 文件格式说明 + 至少 3 个场景（直链、合并、并行分支）的输入输出语义。

- [ ] **Step 2: 写手写规范夹具与失败测试**

`fixtures/linear.ts`：

```ts
import type { LayoutCommit } from '../types';

/** 线性链 A←B←C（C 最新）：单 lane，直边 */
export const linearCommits: LayoutCommit[] = [
  { hash: 'c', parents: ['b'], refs: ['HEAD -> main'] },
  { hash: 'b', parents: ['a'], refs: [] },
  { hash: 'a', parents: [], refs: [] },
];
```

`fixtures/merge.ts`：

```ts
import type { LayoutCommit } from '../types';

/** 两分支合并：a 与 b 并行（lane 0/1），m 合并收拢到 lane 0 */
export const mergeCommits: LayoutCommit[] = [
  { hash: 'm', parents: ['b', 'a'], refs: ['HEAD -> main'] },
  { hash: 'b', parents: ['r'], refs: ['feature'] },
  { hash: 'a', parents: ['r'], refs: [] },
  { hash: 'r', parents: [], refs: [] },
];
```

`build-layout.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { buildLayout } from './build-layout';
import { linearCommits } from './fixtures/linear';
import { mergeCommits } from './fixtures/merge';

describe('buildLayout', () => {
  it('线性链：全部 lane 0，无跨 lane 边', () => {
    const rows = buildLayout(linearCommits);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.edges.every((e) => e.fromLane === 0 && e.toLane === 0))).toBe(true);
  });

  it('合并：分支各自 lane，合并行收拢且边覆盖两 lane', () => {
    const rows = buildLayout(mergeCommits);
    // m 行 lane 0；b 与 a 占 0/1 两个 lane；合并行的边连接两个父 lane
    expect(rows[0].lane).toBe(0);
    const lanes = rows.slice(1).map((r) => r.lane).sort();
    expect(lanes).toEqual([0, 1]);
    expect(rows[0].edges.some((e) => e.toLane === 1)).toBe(true);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @rebased/ui test -- build-layout.test.ts` → FAIL（模块缺失）。

- [ ] **Step 4: 实现 types.ts + build-layout.ts**

`types.ts`：

```ts
/** graph-layout 数据模型（Java vcs-log/graph 的 TS 对应物；Apache-2.0，语义源自 JetBrains 实现） */
export interface LayoutCommit {
  hash: string;
  parents: string[];
  refs: string[];
}

/** 行间边段：连接相邻两行的 lane 位置 */
export interface EdgeSegment {
  fromLane: number;
  toLane: number;
  fromRow: number;
  toRow: number;
}

export interface LayoutRow {
  commit: LayoutCommit;
  lane: number;
  edges: EdgeSegment[];
  color: string;
}
```

`build-layout.ts`（实现者按 Step 1 研读的 Java `GraphLayoutBuilder` 语义用 TS 重写；骨架与关键规则如下，算法细节以 Java 为权威）：

```ts
/**
 * 提交图布局：lane 分配 + 边路由 + 分支着色。
 * 语义对齐 Java GraphLayoutBuilder/GraphLayoutImpl（platform/vcs-log/graph）。
 * 输入自下而上（最旧在前）或自上而下均可——本实现按输入序（新→旧）自上而下分配。
 */
import type { EdgeSegment, LayoutCommit, LayoutRow } from './types';

export function buildLayout(commits: LayoutCommit[]): LayoutRow[] {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const lanes: Array<string | null> = [];      // 每 lane 当前占用提交（未闭合边）
  const rows: LayoutRow[] = [];

  for (let rowIdx = 0; rowIdx < commits.length; rowIdx++) {
    const commit = commits[rowIdx];
    // 1) 闭合已结束的边：lane 顶是当前提交的父提交时释放该 lane 供复用
    // 2) 当前提交取首个空闲 lane；其父边占 lane，为每个额外父开新 lane
    // 3) 边段：连接本行 lane 与父提交所在行/所在 lane（跨 lane 折线）
    // —— 具体实现以 Java 语义为准（本注释即算法要点，非占位）
  }
  return rows;
}
```

（实现者职责：把 Java 的 lane 复用、折叠规则翻译进 1)-3)，以手写夹具 + Java 夹具为验收。）

- [ ] **Step 5: 手写夹具通过**

Run: `pnpm --filter @rebased/ui test -- build-layout.test.ts` → 2/2 PASS。

- [ ] **Step 6: 转制 Java testData 夹具并跑等价测试**

按 Step 1 的格式说明，把 `layoutBuilder` 目录中 3 个场景转成 `fixtures/java/layout-builder-*.ts`（输入 `LayoutCommit[]` + 期望 lane/边快照），在 `build-layout.test.ts` 追加对应 describe（断言与 Java 期望文件一致）。运行 → PASS。

- [ ] **Step 7: 提交**

```powershell
git add packages/client/ui
git commit -m "feat(ui): graph-layout 核心（lane 分配）与 Java testData 夹具"
```

---

### Task 6: graph-layout —— 边路由细节、分支着色与增量对齐

**Files:**
- Modify: `packages/client/ui/src/graph-layout/build-layout.ts`（边形状细节/merge 展开行）
- Create: `packages/client/ui/src/graph-layout/color.ts` + `rows-mapping.ts` + 各自测试
- Create: `packages/client/ui/src/graph-layout/fixtures/java/`（edgesInRow、containingBranches、graphBuilder 转制）

**Interfaces:**
- Consumes: Task 5 的 types/buildLayout。
- Produces: `colorForRef(ref: string): string`（对齐 `GraphColorGetterByHead`：ref 名 hash → 稳定色板；无 ref → 默认灰）；`mapRowsToVisible(rows, appendedNewCount): { visible: LayoutRow[]; offset: number }`（新提交插顶部、旧行下移的行号对齐）；buildLayout 输出 `color` 字段填充。

- [ ] **Step 1: 研读 Java 参照**

读 `EdgePrintElementImpl.kt`（边形状：直连/折线/merge 展开行填充规则）、`GraphColorGetterByHead.kt:11-17` + `DefaultColorGenerator.kt:39-62`（色板算法）。

- [ ] **Step 2: 写失败测试**

`color.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { colorForRef } from './color';

describe('colorForRef', () => {
  it('同一 ref 稳定同色，不同 ref 大概率异色，无 ref 为默认', () => {
    expect(colorForRef('main')).toBe(colorForRef('main'));
    expect(colorForRef('main')).not.toBe(colorForRef('feature'));
    expect(colorForRef('')).toBe('#888888');
  });
});
```

`rows-mapping.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { mapRowsToVisible } from './rows-mapping';
import type { LayoutRow } from './types';

function row(hash: string): LayoutRow {
  return { commit: { hash, parents: [], refs: [] }, lane: 0, edges: [], color: '#888888' };
}

describe('mapRowsToVisible', () => {
  it('新提交插顶部，旧行下移', () => {
    const visible = mapRowsToVisible([row('c'), row('b'), row('a')], 1);
    // 1 条新提交到达：总行数 4，新行在最前
    expect(visible.offset).toBe(1);
    expect(visible.visible.map((r) => r.commit.hash)).toEqual(['c', 'b', 'a']);
  });
});
```

`build-layout.test.ts` 追加：merge 展开行边形状断言 + `color` 字段非空断言；再按 Step 1 转制 `edgesInRow`/`containingBranches`/`graphBuilder` 夹具并断言。

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @rebased/ui test` → 新用例 FAIL。

- [ ] **Step 4: 实现**

- `color.ts`：ref 名 string hash（FNV-1a 或 Java 同款）→ 固定 HSB 色板（对齐 Java `DefaultColorGenerator`）；空 ref 返回 `'#888888'`
- `rows-mapping.ts`：`mapRowsToVisible(rows, appendedNewCount)` 语义=顶部插入（首跑简化：调用方重算 buildLayout 全量，本函数提供行偏移对齐）
- `build-layout.ts`：边形状细节按 `EdgePrintElementImpl` 补全（含 merge 展开行的填充边）；`color` 字段填 `colorForRef(refs 首个 ref)`

- [ ] **Step 5: 运行确认通过 + 全链**

Run: `pnpm --filter @rebased/ui test` → 全绿（≥6 用例：手写 2 + Java 夹具 ≥4）；`pnpm typecheck`、`pnpm format` 全仓绿；`pnpm test` 全链（contracts 7 + core 21 + api 21 + ui ≥6 = **55 用例**）。

- [ ] **Step 6: 提交**

```powershell
git add packages/client/ui
git commit -m "feat(ui): graph-layout 边路由、分支着色与可见行映射"
```

---

## 自审记录（本计划 vs spec）

- spec §4.3 取消链路 4 项 → Task 1（core）✓ + Task 3（api 透传）✓ + 路由层断开（Plan 2b）✓ 已标注
- spec §5.3 readFileAtRev/getFileVersions/FileVersions → Task 2/3 ✓
- spec §4.2 events.ts → Task 4 ✓
- spec §3 graph-layout 移植（lane/边/着色/可见行/testData）→ Task 5/6 ✓
- 占位符扫描：无 TBD/TODO；Task 5/6 的算法实现以 Java 源码为权威参照（有文件清单 + 夹具验收，非占位）
- 类型一致性：`LayoutRow` 字段（Task 5 定义，Task 6 使用）、`GitExitError` exitCode 130 语义（Task 1 定义，Task 3 测试使用）、`getFileVersions` 签名（Task 3 定义，Plan 2b 使用）一致
- 计数：本计划完成后 core 21、api 21（含 events 2 + getFileVersions 2 + signal 1 = 原 16 + 5 = 21）✓
