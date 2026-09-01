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
});
