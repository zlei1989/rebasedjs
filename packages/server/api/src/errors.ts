/** 错误出口：统一把引擎层/未知错误折成 ServiceError，框架层只需面对一种错误。 */
import { GitExitError } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';

/**
 * 索引锁竞争识别：git 在另一个进程持有 `.git/index.lock` 时写索引会失败，报
 * `Unable to create '…/.git/index.lock': File exists.`（冒烟 D-41：应用自身的 watcher/轮询与
 * 界面触发的写操作并发时偶发，之前把这段 raw 英文原样弹给用户且不可重试）。
 */
function isIndexLockError(error: GitExitError): boolean {
  return /index\.lock/i.test(error.stderr);
}

export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof GitExitError) {
    // 瞬态竞争折成可重试的 STALE_LOCK(409) + 中文提示，而不是与真实失败混在同一条 raw 报错里
    if (isIndexLockError(error)) {
      return new ServiceError('STALE_LOCK', '仓库正忙（索引被其它 git 操作锁定），请稍后重试', {
        cause: error,
        context: { args: error.args, exitCode: error.exitCode },
      });
    }
    return new ServiceError('GIT_ERROR', `git 命令失败：${error.message}`, {
      cause: error,
      context: { args: error.args, exitCode: error.exitCode, stderr: error.stderr },
    });
  }
  return new ServiceError('GIT_ERROR', '内部错误', { cause: error });
}
