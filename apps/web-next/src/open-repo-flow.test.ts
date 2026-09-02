/**
 * 首页打开流程测试（终审 Finding 2）：useOpenRepo trigger 失败 → antd message.error 呈现可读错误，不刷新不跳转。
 * node 环境：spy mock 掉 message.error（不触 DOM）；openRepo 以 reject 模拟 useOpenRepo 失败（ServiceError.message 为可读中文）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { ServiceError } from '@rebased/contracts';
import { openRepoFlow } from './open-repo-flow';

describe('openRepoFlow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('openRepo（useOpenRepo trigger）失败：message.error 呈现可读错误，不刷新不跳转', async () => {
    const spy = vi
      .spyOn(message, 'error')
      .mockImplementation(() => (() => {}) as unknown as ReturnType<typeof message.error>);
    const openRepo = vi.fn(async () => {
      throw new ServiceError('NOT_A_GIT_REPO', '不是 Git 仓库');
    });
    const refresh = vi.fn(async () => undefined);
    const navigate = vi.fn();

    await openRepoFlow({ path: '/plain-dir', openRepo, refresh, navigate });

    expect(spy).toHaveBeenCalledWith('不是 Git 仓库');
    expect(refresh).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
