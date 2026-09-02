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
