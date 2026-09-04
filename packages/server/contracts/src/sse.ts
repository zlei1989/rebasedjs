/**
 * SSE 帧序列化：统一 { type, payload } 事件格式。
 * 服务层产出事件对象，框架层用本函数转 SSE 文本（AsyncIterable → 流）。
 * 事件名约定：`/events` 流除 `repo.state-changed` 外，另有 `operation.state-changed`
 * （payload 为 domain.ts 的 OperationState，描述仓库进行中的 merge/rebase/cherry-pick/revert 状态）。
 * 另有 `refs.changed`（fetch/push/pull 后引用发生移动时推送）：payload 为 { refs: string[] }
 * 变化引用名列表，空数组表示指纹变化但名单未知——watcher 实现简化时允许恒空。
 */
export interface SseEvent {
  type: string;
  payload: unknown;
}

/** refs.changed 事件名常量：payload 为 { refs: string[] }（空数组 = 指纹变化但名单未知） */
export const SSE_EVENT_REFS_CHANGED = 'refs.changed';

export function serializeSseEvent(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
