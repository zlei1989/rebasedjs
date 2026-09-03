import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCommitIdentity, createCommit } from './commit';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('commit 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('createCommit 提交暂存区并返回新哈希', async () => {
    const repo = createTmpRepo(); // fixture 已预置 user.name/user.email
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    const { hash } = await createCommit(repo, { message: '测试提交' });
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('测试提交');
  });

  it('assertCommitIdentity 缺 user.name 或 user.email 时抛 INVALID_QUERY', () => {
    const missing = [
      { key: 'user.name', value: null, localValue: null },
      { key: 'user.email', value: 'a@b.c', localValue: 'a@b.c' },
    ];
    expect(() => assertCommitIdentity(missing)).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUERY', message: '未配置 user.name 或 user.email，请先在设置页配置' }),
    );
    const missingEmail = [
      { key: 'user.name', value: 'Test', localValue: 'Test' },
      { key: 'user.email', value: null, localValue: null },
    ];
    expect(() => assertCommitIdentity(missingEmail)).toThrowError(expect.objectContaining({ code: 'INVALID_QUERY' }));
  });

  it('assertCommitIdentity 生效值齐全时不抛', () => {
    const ok = [
      { key: 'user.name', value: 'Test', localValue: null },
      { key: 'user.email', value: 'a@b.c', localValue: null },
    ];
    expect(() => assertCommitIdentity(ok)).not.toThrow();
  });
});
