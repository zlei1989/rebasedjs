/** 仓库状态推送：轮询 status、operation 与 refs 指纹，仅各自变化时产对应事件。
 *  事件序：首帧依次产 repo.state-changed（当前状态）、operation.state-changed（当前操作）
 *  与 refs.changed（基线：当前全量 refname 列表），之后 diff 比较。
 *  refs 指纹覆盖 refs/heads + refs/remotes + refs/tags + refs/stash：
 *  分支/标签/贮藏/远程引用的创建、删除与指向移动均会改变指纹并产 refs.changed（payload.refs 为变化名单）。
 *  局限：HEAD 指向切换（checkout 换分支不改任何 ref 值）不改变指纹、不产 refs.changed；
 *  该场景由 status.branch 字段变化触发的 repo.state-changed 帧兜底。 */
import type { OperationState, RepoStatus } from '@rebased/contracts';
import { SSE_EVENT_REFS_CHANGED } from '@rebased/contracts';
import { diffRefsSnapshots, takeRefsSnapshot } from '@rebased/core';
import { getOperation } from './operation';
import { getRepoStatus } from './status';

export type RepoStateEvent =
  | { type: 'repo.state-changed'; payload: RepoStatus }
  | { type: 'operation.state-changed'; payload: OperationState }
  | { type: typeof SSE_EVENT_REFS_CHANGED; payload: { refs: string[] } };

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

function operationEquals(a: OperationState, b: OperationState): boolean {
  return a.kind === b.kind && a.step === b.step && a.total === b.total;
}

export async function* watchRepoStatus(repoPath: string, opts: { intervalMs?: number; signal?: AbortSignal } = {}): AsyncIterable<RepoStateEvent> {
  const intervalMs = opts.intervalMs ?? 2000;
  let lastStatus = await getRepoStatus(repoPath);
  let lastOperation = await getOperation(repoPath);
  let lastRefs = await takeRefsSnapshot(repoPath);
  yield { type: 'repo.state-changed', payload: lastStatus };
  yield { type: 'operation.state-changed', payload: lastOperation };
  // refs 基线帧：客户端据此建立当前引用全集（排序输出，顺序稳定）
  yield { type: SSE_EVENT_REFS_CHANGED, payload: { refs: Object.keys(lastRefs.refs).sort() } };
  while (!opts.signal?.aborted) {
    try {
      await sleep(intervalMs, opts.signal);
    } catch {
      return; // 中止：结束生成器
    }
    const [status, operation, refs] = await Promise.all([getRepoStatus(repoPath), getOperation(repoPath), takeRefsSnapshot(repoPath)]);
    if (!statusEquals(lastStatus, status)) {
      lastStatus = status;
      yield { type: 'repo.state-changed', payload: status };
    }
    if (!operationEquals(lastOperation, operation)) {
      lastOperation = operation;
      yield { type: 'operation.state-changed', payload: operation };
    }
    if (refs.fingerprint !== lastRefs.fingerprint) {
      // 指纹变化才产 refs.changed：payload 为两快照 diff 出的变化/新增/删除 refname 名单
      yield { type: SSE_EVENT_REFS_CHANGED, payload: { refs: diffRefsSnapshots(lastRefs, refs) } };
      lastRefs = refs;
    }
  }
}
