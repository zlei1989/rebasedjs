/**
 * web-next auth 账户路由测试（应用级，无 repoId）：accounts 列表/添加/覆盖/删除与 zod 拒绝。
 * 拆分自原 routes.test.ts 的 'web-next auth 账户路由（应用级，无 repoId）' describe：
 * 原单文件 194s 是测试提速瓶颈，按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离（REBASED_CONFIG_DIR + 临时目录清理）见 ./testing/routes-helpers。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getAccounts, POST as postAccounts } from '../app/api/auth/accounts/route';
import { POST as postAccountDelete } from '../app/api/auth/accounts/delete/route';
import { cleanupTestEnv, setupTestEnv } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next auth 账户路由（应用级，无 repoId）', () => {
  const jsonPost = (url: string, body: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET /api/auth/accounts：空配置返回 200 与空账户列表', async () => {
    const res = await getAccounts();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：添加返回掩码视图且响应不含原 token', async () => {
    const token = 'ghp_secret123456';
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).toEqual({ accounts: [{ host: 'github.com', account: 'zhang', tokenPreview: 'ghp_***' }] });
  });

  it('POST /api/auth/accounts：同 host+account 重复添加覆盖（列表长度 1）', async () => {
    await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'oldtoken123456' }));
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'newtoken654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].tokenPreview).toBe('newt***');
  });

  it('POST /api/auth/accounts/delete：删除后列表移除该账户', async () => {
    await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'ghp_abc123' }));
    const res = await postAccountDelete(jsonPost('http://localhost/api/auth/accounts/delete', { host: 'github.com', account: 'zhang' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：空 token（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('POST /api/auth/accounts/delete：删除不存在账户返回 400 INVALID_QUERY', async () => {
    const res = await postAccountDelete(jsonPost('http://localhost/api/auth/accounts/delete', { host: 'github.com', account: 'nobody' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});
