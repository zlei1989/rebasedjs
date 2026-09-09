/**
 * web-koa auth 账户端点集成测试（应用级，无 repoId；拆分自 app.test.ts）。
 * 职责：/api/auth/accounts 及 /delete 端点——账户列表、添加（掩码视图、token 不落响应）、
 * 重复添加覆盖、删除、zod 反例（空 token/不存在账户）断言。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空账户存储）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDirs, startServer, tmpDir } from './testing/integration';

let base = '';
let closeServer: () => Promise<void> = async () => {};

beforeAll(async () => {
  const started = await startServer();
  base = started.base;
  closeServer = started.close;
});

afterAll(async () => {
  await closeServer();
});

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-koa-config-');
});

afterEach(async () => {
  delete process.env.REBASED_CONFIG_DIR;
  await cleanupDirs();
});

describe('web-koa auth 账户端点（应用级，无 repoId）', () => {
  const postJson = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET /api/auth/accounts：空配置返回 200 与空账户列表', async () => {
    const res = await fetch(`${base}/api/auth/accounts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：添加返回掩码视图且响应不含原 token', async () => {
    const token = 'ghp_secret123456';
    const res = await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).toEqual({ accounts: [{ host: 'github.com', account: 'zhang', tokenPreview: 'ghp_***' }] });
  });

  it('POST /api/auth/accounts：同 host+account 重复添加覆盖（列表长度 1）', async () => {
    await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'oldtoken123456' });
    const res = await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'newtoken654321' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ tokenPreview: string }> };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].tokenPreview).toBe('newt***');
  });

  it('POST /api/auth/accounts/delete：删除后列表移除该账户', async () => {
    await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'ghp_abc123' });
    const res = await postJson('/api/auth/accounts/delete', { host: 'github.com', account: 'zhang' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：空 token（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const res = await postJson('/api/auth/accounts', { host: 'github.com', account: 'zhang', token: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('POST /api/auth/accounts/delete：删除不存在账户返回 400 INVALID_QUERY', async () => {
    const res = await postJson('/api/auth/accounts/delete', { host: 'github.com', account: 'nobody' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});
