/** events.ts 测试：subscribeSse 帧解析（含跨块拆分/非 2xx）+ useRepoEvents 回调与取消 */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError, serializeSseEvent, type RepoStatus } from '@rebased/contracts';
import { subscribeSse, useRepoEvents } from './events';

const STATUS: RepoStatus = { branch: 'main', upstream: null, ahead: 0, behind: 0, entries: [] };

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function Probe({ repoId, onChange }: { repoId: string; onChange: (status: RepoStatus) => void }) {
  useRepoEvents(repoId, onChange);
  return null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscribeSse', () => {
  it('解析 data: 帧并逐帧回调 onEvent', async () => {
    const body = serializeSseEvent({ type: 'a', payload: 1 }) + serializeSseEvent({ type: 'b', payload: 2 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf([body]), { status: 200 })));
    const events: Array<{ type: string; payload: unknown }> = [];

    await subscribeSse('/api/repos/r1/events', (event) => events.push(event));

    expect(events).toEqual([
      { type: 'a', payload: 1 },
      { type: 'b', payload: 2 },
    ]);
  });

  it('帧跨多个流块拆分时仍能完整解析', async () => {
    const frame = serializeSseEvent({ type: 'repo.state-changed', payload: STATUS });
    const mid = Math.floor(frame.length / 2);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamOf([frame.slice(0, mid), frame.slice(mid)]), { status: 200 })));
    const events: Array<{ type: string; payload: unknown }> = [];

    await subscribeSse('/api/repos/r1/events', (event) => events.push(event));

    expect(events).toEqual([{ type: 'repo.state-changed', payload: STATUS }]);
  });

  it('非 2xx 响应抛 ServiceError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    const err = await subscribeSse('/api/repos/r1/events', () => {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).message).toBe('SSE 500');
  });
});

describe('useRepoEvents', () => {
  it('repo.state-changed 事件触发 onChange 回调，卸载时中止订阅', async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(stream, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe, { repoId: 'r1', onChange }));
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r1/events', expect.objectContaining({ signal: expect.any(AbortSignal) }));

    await act(async () => {
      controller.enqueue(encoder.encode(serializeSseEvent({ type: 'repo.state-changed', payload: STATUS })));
    });
    expect(onChange).toHaveBeenCalledWith(STATUS);

    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    await act(async () => {
      renderer.unmount();
    });
    expect(signal.aborted).toBe(true);
  });

  it('非 repo.state-changed 事件不触发 onChange', async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));
    const onChange = vi.fn();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(createElement(Probe, { repoId: 'r1', onChange }));
    });
    await act(async () => {
      controller.enqueue(encoder.encode(serializeSseEvent({ type: 'log.line', payload: { hash: 'x' } })));
    });

    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      renderer.unmount();
    });
  });
});
