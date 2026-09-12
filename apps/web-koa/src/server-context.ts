/** 路由层共享：错误映射 + repoId 解析（三件套的后两环，Koa 版直接设 ctx） */
import { getRepoById, toServiceError } from '@rebased/api';
import { httpStatusFor } from '@rebased/contracts';
import type { ParameterizedContext } from 'koa';
import { ZodError } from 'zod';

/**
 * 请求体解析失败的唯一标记类型（与 web-next 同构）：**只有它**映射为 400「请求体不是合法 JSON」。
 * 冒烟 D-42：此前把**任何** SyntaxError 都映射成该 400，会让「读配置/解析远端响应失败」这类
 * 服务端内部解析异常冒充客户端请求体问题。bodyparser 层的错误在 app.ts 里被标记成它。
 */
export class InvalidRequestBodyError extends SyntaxError {
  constructor(cause?: unknown) {
    super('请求体不是合法 JSON');
    this.name = 'InvalidRequestBodyError';
    this.cause = cause;
  }
}

/**
 * 统一错误出口（Koa 版）：toServiceError → ctx.status + {error:{code,message,context?}} JSON body。
 * zod 校验失败（ZodError）与请求体 JSON 语法失败映射为 INVALID_QUERY（400）；其余按 toServiceError ——与 web-next 同构。
 */
export function handleApiError(error: unknown, ctx: ParameterizedContext): void {
  if (error instanceof ZodError) {
    ctx.status = httpStatusFor('INVALID_QUERY');
    ctx.body = { error: { code: 'INVALID_QUERY', message: '查询参数不合法', context: error.issues } };
    return;
  }
  if (error instanceof InvalidRequestBodyError) {
    ctx.status = httpStatusFor('INVALID_QUERY');
    ctx.body = { error: { code: 'INVALID_QUERY', message: '请求体不是合法 JSON' } };
    return;
  }
  const serviceError = toServiceError(error);
  ctx.status = httpStatusFor(serviceError.code);
  ctx.body = { error: { code: serviceError.code, message: serviceError.message, ...(serviceError.context ? { context: serviceError.context } : {}) } };
}

export function resolveRepo(repoId: string): string {
  return getRepoById(repoId).path; // REPO_NOT_FOUND 抛错由调用方 handleApiError 兜底
}
