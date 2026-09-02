/** SSE 传输与仓库事件 hook：fetch 流解析 `data: ` 帧（与取消链路一致，不用 EventSource） */
import { useEffect, useRef } from 'react';
import { ServiceError, type RepoStatus, type SseEvent } from '@rebased/contracts';

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

/** 订阅仓库状态推送：repo.state-changed → onChange（payload 为最新 RepoStatus）；卸载即中止 */
export function useRepoEvents(repoId: string, onChange: (status: RepoStatus) => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const ac = new AbortController();
    void subscribeSse(`/api/repos/${repoId}/events`, (event: SseEvent) => {
      if (event.type === 'repo.state-changed') onChangeRef.current(event.payload as RepoStatus);
    }, ac.signal).catch(() => {
      // 断流/取消：静默（重连策略由上层决定）
    });
    return () => ac.abort();
  }, [repoId]);
}
