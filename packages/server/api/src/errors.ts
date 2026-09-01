/** 错误出口：统一把引擎层/未知错误折成 ServiceError，框架层只需面对一种错误。 */
import { GitExitError } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';

export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof GitExitError) {
    return new ServiceError('GIT_ERROR', `git 命令失败：${error.message}`, {
      cause: error,
      context: { args: error.args, exitCode: error.exitCode, stderr: error.stderr },
    });
  }
  return new ServiceError('GIT_ERROR', '内部错误', { cause: error });
}
