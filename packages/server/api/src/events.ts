/** 仓库状态推送：轮询 status 与 operation，仅各自变化时产对应事件。
 *  事件序：首帧依次产 repo.state-changed（当前状态）与 operation.state-changed（当前操作），之后 diff 比较。 */
import type { OperationState, RepoStatus } from '@rebased/contracts';
import { getOperation } from './operation';
import { getRepoStatus } from './status';

export type RepoStateEvent =
  | { type: 'repo.state-changed'; payload: RepoStatus }
  | { type: 'operation.state-changed'; payload: OperationState };

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
  yield { type: 'repo.state-changed', payload: lastStatus };
  yield { type: 'operation.state-changed', payload: lastOperation };
  while (!opts.signal?.aborted) {
    try {
      await sleep(intervalMs, opts.signal);
    } catch {
      return; // 中止：结束生成器
    }
    const [status, operation] = await Promise.all([getRepoStatus(repoPath), getOperation(repoPath)]);
    if (!statusEquals(lastStatus, status)) {
      lastStatus = status;
      yield { type: 'repo.state-changed', payload: status };
    }
    if (!operationEquals(lastOperation, operation)) {
      lastOperation = operation;
      yield { type: 'operation.state-changed', payload: operation };
    }
  }
}
