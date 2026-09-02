/** http.ts 测试：URL/方法断言 + 非 2xx → ServiceError 错误映射（vi.stubGlobal fetch） */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '@rebased/contracts';
import { getJson, postJson, putJson } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getJson', () => {
  it('2xx：按传入 URL 发起 GET 并解析 JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, [{ id: 'r1' }]));
    vi.stubGlobal('fetch', fetchMock);

    const data = await getJson<Array<{ id: string }>>('/api/repos');

    expect(fetchMock).toHaveBeenCalledWith('/api/repos');
    expect(data).toEqual([{ id: 'r1' }]);
  });

  it('非 2xx 且响应含 {error:{code,message}}：抛 ServiceError 并保留 code/message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: { code: 'REPO_NOT_FOUND', message: '仓库不存在' } })));

    const err = await getJson('/api/repos/nope/status').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe('REPO_NOT_FOUND');
    expect((err as ServiceError).message).toBe('仓库不存在');
  });

  it('非 2xx 且响应非 JSON：兜底 GIT_ERROR + HTTP 状态码 message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })));

    const err = await getJson('/api/settings').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe('GIT_ERROR');
    expect((err as ServiceError).message).toBe('HTTP 502');
  });
});

describe('postJson', () => {
  it('以 POST + JSON 请求体发起请求并解析响应', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { repoId: 'r9' }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await postJson<{ repoId: string }>('/api/repos/open', { path: '/tmp/repo' });

    expect(fetchMock).toHaveBeenCalledWith('/api/repos/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/repo' }),
    });
    expect(data).toEqual({ repoId: 'r9' });
  });

  it('非 2xx：映射服务端错误码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { error: { code: 'NOT_A_GIT_REPO', message: '不是 Git 仓库' } })));

    const err = await postJson('/api/repos/open', { path: '/tmp/none' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe('NOT_A_GIT_REPO');
    expect((err as ServiceError).message).toBe('不是 Git 仓库');
  });
});

describe('putJson', () => {
  it('以 PUT + JSON 请求体发起请求并解析响应', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { logInEditor: true, recentRepoIds: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const data = await putJson('/api/settings', { logInEditor: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logInEditor: true }),
    });
    expect(data).toEqual({ logInEditor: true, recentRepoIds: [] });
  });
});
