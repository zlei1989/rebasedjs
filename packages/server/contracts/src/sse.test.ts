import { describe, expect, it } from 'vitest';
import { serializeSseEvent, SSE_EVENT_REFS_CHANGED } from './sse';

describe('serializeSseEvent', () => {
  it('序列化为 data: JSON 帧', () => {
    expect(serializeSseEvent({ type: 'log.line', payload: { hash: 'abc' } }))
      .toBe('data: {"type":"log.line","payload":{"hash":"abc"}}\n\n');
  });
});

describe('SSE_EVENT_REFS_CHANGED（refs.changed 事件名约定）', () => {
  it('常量值为 refs.changed', () => {
    expect(SSE_EVENT_REFS_CHANGED).toBe('refs.changed');
  });
});
