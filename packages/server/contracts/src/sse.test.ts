import { describe, expect, it } from 'vitest';
import { serializeSseEvent } from './sse';

describe('serializeSseEvent', () => {
  it('序列化为 data: JSON 帧', () => {
    expect(serializeSseEvent({ type: 'log.line', payload: { hash: 'abc' } }))
      .toBe('data: {"type":"log.line","payload":{"hash":"abc"}}\n\n');
  });
});
