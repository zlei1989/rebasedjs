/** 路由层共享：错误映射 + repoId 解析（三件套的后两环） */
import { getRepoById, toServiceError } from '@rebased/api';
import { httpStatusFor } from '@rebased/contracts';
import { ZodError } from 'zod';

/**
 * 统一错误出口：toServiceError → 状态码 + {error:{code,message,context?}} JSON body。
 * zod 校验失败（ZodError）映射为 INVALID_QUERY（400），而非未知错误的 GIT_ERROR（500）。
 */
export async function handleApiError(error: unknown, init?: ResponseInit): Promise<Response> {
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: 'INVALID_QUERY', message: '查询参数不合法', context: error.issues } },
      { ...init, status: httpStatusFor('INVALID_QUERY') },
    );
  }
  const serviceError = toServiceError(error);
  return Response.json(
    { error: { code: serviceError.code, message: serviceError.message, ...(serviceError.context ? { context: serviceError.context } : {}) } },
    { ...init, status: httpStatusFor(serviceError.code) },
  );
}

export function resolveRepo(repoId: string): string {
  return getRepoById(repoId).path; // REPO_NOT_FOUND 抛错由调用方 handleApiError 兜底
}
