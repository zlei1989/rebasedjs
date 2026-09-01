import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ServiceError, httpStatusFor } from './errors';

describe('ServiceError', () => {
  it('携带 code 与 context，message 可读', () => {
    const e = new ServiceError('NOT_A_GIT_REPO', '不是 git 仓库', { context: { path: '/tmp/x' } });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('NOT_A_GIT_REPO');
    expect(e.context).toEqual({ path: '/tmp/x' });
    expect(e.message).toBe('不是 git 仓库');
  });

  it('httpStatusFor 覆盖全部错误码', () => {
    expect(httpStatusFor('REPO_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('GIT_ERROR')).toBe(500);
    expect(httpStatusFor('CANCELLED')).toBe(499);
    for (const code of ERROR_CODES) expect(typeof httpStatusFor(code)).toBe('number');
  });
});
