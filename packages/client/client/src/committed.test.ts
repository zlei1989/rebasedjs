/** committed.ts 测试：useCommitFiles（单提交变更文件，Show All Affected 语义；hash 空挂 null key 条件拉取） */
import { act, createElement } from 'react';
import TestRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommittedEntry } from '@rebased/contracts';
import { useCommitFiles } from './committed';
import { freshCache } from './testing/fresh-cache';

const ENTRY: CommittedEntry = {
  hash: 'aaaaaa',
  shortHash: 'aaaaaa',
  subject: 'add b',
  author: 'Bob',
  dateIso: '2024-01-01T00:00:00Z',
  parents: [],
  files: [
    { path: 'a.txt', status: 'M' },
    { path: 'b.txt', status: 'A' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCommitFiles', () => {
  it('请求单提交端点并返回 CommittedEntry（hash 拼入路径）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENTRY), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: CommittedEntry; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useCommitFiles('r-commit-files-1', 'aaaaaa');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });
    await act(async () => {
      await vi.waitFor(() => expect(result?.data).toEqual(ENTRY));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/r-commit-files-1/commits/aaaaaa');
    await act(async () => {
      renderer.unmount();
    });
  });

  it('hash 空串挂 null key 不发请求（条件拉取）', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ENTRY), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let result: { data?: CommittedEntry; error?: unknown } | undefined;
    function Probe() {
      const { data, error } = useCommitFiles('r-commit-files-2', '');
      result = { data, error };
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(freshCache(createElement(Probe)));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.data).toBeUndefined();
    await act(async () => {
      renderer.unmount();
    });
  });
});
