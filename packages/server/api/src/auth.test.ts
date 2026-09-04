import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteAccount, listAccounts, upsertAccount } from './auth';
import { loadConfig } from './lib/config-store';

let configDir: string;

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'rebased-auth-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

describe('auth 账户/令牌存储', () => {
  it('空配置 → 空列表', () => {
    expect(listAccounts()).toEqual({ accounts: [] });
  });

  it('upsert 返回掩码视图：tokenPreview = 前 4 位 + ***，响应任何字段不含完整 token', () => {
    const token = 'ghp_abcdef1234567890';
    const view = upsertAccount({ host: 'github.com', account: 'alice', token });
    expect(view).toEqual({ accounts: [{ host: 'github.com', account: 'alice', tokenPreview: 'ghp_***' }] });
    // 安全断言：响应序列化后不得出现原始 token（掩码以外任何字段都不许泄露）
    expect(JSON.stringify(view)).not.toContain(token);
    expect(listAccounts()).toEqual(view);
  });

  it('token 长度 ≤4 时全掩码为 ***', () => {
    const view = upsertAccount({ host: 'gitlab.example.com', account: 'bob', token: 'abcd' });
    const entry = view.accounts.find((a) => a.host === 'gitlab.example.com' && a.account === 'bob');
    expect(entry?.tokenPreview).toBe('***');
    expect(JSON.stringify(view)).not.toContain('abcd');
  });

  it('同 host+account 再 upsert → 覆盖而非重复', () => {
    upsertAccount({ host: 'github.com', account: 'alice', token: 'oldtoken123456' });
    const view = upsertAccount({ host: 'github.com', account: 'alice', token: 'newtoken654321' });
    const matches = view.accounts.filter((a) => a.host === 'github.com' && a.account === 'alice');
    expect(matches).toHaveLength(1);
    expect(matches[0].tokenPreview).toBe('newt***');
  });

  it('token 明文持久化在配置文件（内部簿记），掩码只作用于出口视图', () => {
    const stored = loadConfig().auth?.accounts.find((a) => a.host === 'github.com' && a.account === 'alice');
    expect(stored?.token).toBe('newtoken654321');
  });

  it('delete 移除账户并返回刷新掩码视图', () => {
    const view = deleteAccount({ host: 'github.com', account: 'alice' });
    expect(view.accounts.some((a) => a.host === 'github.com' && a.account === 'alice')).toBe(false);
    expect(loadConfig().auth?.accounts.some((a) => a.host === 'github.com' && a.account === 'alice')).toBe(false);
  });

  it('delete 不存在的账户 → ServiceError INVALID_QUERY', () => {
    expect(() => deleteAccount({ host: 'github.com', account: 'nobody' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUERY', message: expect.stringContaining('账户不存在：') }),
    );
  });

  it.runIf(process.platform !== 'win32')('saveConfig 落盘后配置文件权限为 0600（POSIX）', () => {
    upsertAccount({ host: 'github.com', account: 'carol', token: 'token123456' });
    const mode = statSync(join(configDir, 'config.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
