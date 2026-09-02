/** 路由层共享：错误映射 + repoId 解析（三件套的后两环，Koa 版直接设 ctx） */
import { getRepoById, toServiceError } from '@rebased/api';
import { httpStatusFor } from '@rebased/contracts';
import type { ParameterizedContext } from 'koa';
import { ZodError } from 'zod';

/**
 * 统一错误出口（Koa 版）：toServiceError → ctx.status + {error:{code,message,context?}} JSON body。
 * zod 校验失败（ZodError）映射为 INVALID_QUERY（400），而非未知错误的 GIT_ERROR（500）——与 web-next 同构。
 */
export function handleApiError(error: unknown, ctx: ParameterizedContext): void {
  if (error instanceof ZodError) {
    ctx.status = httpStatusFor('INVALID_QUERY');
    ctx.body = { error: { code: 'INVALID_QUERY', message: '查询参数不合法', context: error.issues } };
    return;
  }
  const serviceError = toServiceError(error);
  ctx.status = httpStatusFor(serviceError.code);
  ctx.body = { error: { code: serviceError.code, message: serviceError.message, ...(serviceError.context ? { context: serviceError.context } : {}) } };
}

export function resolveRepo(repoId: string): string {
  return getRepoById(repoId).path; // REPO_NOT_FOUND 抛错由调用方 handleApiError 兜底
}
