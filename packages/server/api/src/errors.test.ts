import { describe, expect, it } from 'vitest';
import { GitExitError } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import { toServiceError } from './errors';

describe('toServiceError', () => {
  it('ServiceError 原样返回', () => {
    const e = new ServiceError('CONFLICT', '有冲突');
    expect(toServiceError(e)).toBe(e);
  });

  it('GitExitError 映射为 GIT_ERROR 并携带 stderr 上下文', () => {
    const g = new GitExitError(['status'], 128, '', 'fatal: not a git repository');
    const s = toServiceError(g);
    expect(s.code).toBe('GIT_ERROR');
    expect(s.cause).toBe(g);
    expect((s.context as { stderr: string }).stderr).toContain('fatal');
  });

  it('未知错误兜底为 GIT_ERROR', () => {
    const s = toServiceError(new Error('boom'));
    expect(s.code).toBe('GIT_ERROR');
  });

  // 冒烟 D-41：index.lock 是并发写索引的瞬态竞争，不该把 raw git 英文原样弹给用户
  it('index.lock 竞争 → STALE_LOCK(409) 且给可重试的中文提示', () => {
    const g = new GitExitError(
      ['add', '-A'],
      128,
      '',
      'fatal: Unable to create \'D:/repo/.git/index.lock\': File exists.\n\nAnother git process seems to be running in this repository',
    );
    const s = toServiceError(g);
    expect(s.code).toBe('STALE_LOCK');
    expect(s.message).toContain('仓库正忙');
    expect((s.context as { args: string[] }).args).toEqual(['add', '-A']);
  });

  it('其它 git 失败仍为 GIT_ERROR（不误判成锁竞争）', () => {
    const g = new GitExitError(['status'], 128, '', 'fatal: not a git repository');
    expect(toServiceError(g).code).toBe('GIT_ERROR');
  });
});
