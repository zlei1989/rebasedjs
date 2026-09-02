/**
 * SSE 帧序列化：统一 { type, payload } 事件格式。
 * 服务层产出事件对象，框架层用本函数转 SSE 文本（AsyncIterable → 流）。
 * 事件名约定：`/events` 流除 `repo.state-changed` 外，另有 `operation.state-changed`
 * （payload 为 domain.ts 的 OperationState，描述仓库进行中的 merge/rebase/cherry-pick/revert 状态）。
 */
export interface SseEvent {
  type: string;
  payload: unknown;
}

export function serializeSseEvent(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
