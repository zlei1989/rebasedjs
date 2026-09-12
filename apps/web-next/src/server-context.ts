/** 路由层共享：错误映射 + repoId 解析（三件套的后两环） */
import { getRepoById, toServiceError } from '@rebased/api';
import { httpStatusFor } from '@rebased/contracts';
import { ZodError } from 'zod';

/**
 * 请求体解析失败的唯一标记类型：**只有它**映射为 400「请求体不是合法 JSON」。
 * 冒烟 D-42：此前把**任何** SyntaxError 都映射成该 400，于是「读配置文件失败」这类
 * 服务端内部解析异常被伪装成客户端请求体问题（文案误导 + 排查方向被带偏）。
 */
export class InvalidRequestBodyError extends SyntaxError {
  constructor(cause?: unknown) {
    super('请求体不是合法 JSON');
    this.name = 'InvalidRequestBodyError';
    this.cause = cause;
  }
}

/** 读 JSON 请求体：把 `req.json()` 的解析失败标记成 InvalidRequestBodyError（其余 SyntaxError 不再冒充它） */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (error) {
    throw new InvalidRequestBodyError(error);
  }
}

/**
 * 统一错误出口：toServiceError → 状态码 + {error:{code,message,context?}} JSON body。
 * zod 校验失败（ZodError）映射为 INVALID_QUERY（400）；请求体 JSON 语法失败映射为 400 同码；
 * 其余错误（含服务端内部其它 SyntaxError）按 toServiceError 折成 GIT_ERROR（500）。
 */
export async function handleApiError(error: unknown, init?: ResponseInit): Promise<Response> {
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: 'INVALID_QUERY', message: '查询参数不合法', context: error.issues } },
      { ...init, status: httpStatusFor('INVALID_QUERY') },
    );
  }
  if (error instanceof InvalidRequestBodyError) {
    return Response.json(
      { error: { code: 'INVALID_QUERY', message: '请求体不是合法 JSON' } },
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
