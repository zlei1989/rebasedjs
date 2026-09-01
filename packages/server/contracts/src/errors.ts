/**
 * 统一错误模型：错误码 + 可直接展示的中文 message + 可选上下文。
 * 框架层按 httpStatusFor 把 code 映射为 HTTP 状态码。
 */
export const ERROR_CODES = [
  'REPO_NOT_FOUND',
  'NOT_A_GIT_REPO',
  'INVALID_REF',
  'INVALID_QUERY',
  'CONFLICT',
  'AUTH_FAILED',
  'RATE_LIMITED',
  'HOOK_FAILED',
  'STALE_LOCK',
  'OPERATION_IN_PROGRESS',
  'GIT_ERROR',
  'CANCELLED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ServiceError extends Error {
  readonly code: ErrorCode;
  readonly context?: unknown;

  constructor(code: ErrorCode, message: string, options?: { context?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'ServiceError';
    this.code = code;
    this.context = options?.context;
  }
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  REPO_NOT_FOUND: 404,
  NOT_A_GIT_REPO: 400,
  INVALID_REF: 400,
  INVALID_QUERY: 400,
  CONFLICT: 409,
  AUTH_FAILED: 401,
  RATE_LIMITED: 429,
  HOOK_FAILED: 422,
  STALE_LOCK: 409,
  OPERATION_IN_PROGRESS: 409,
  GIT_ERROR: 500,
  // 客户端已断开连接，此映射仅作内部兜底，实际无响应可发
  CANCELLED: 499,
};

/** code → HTTP 状态码（两个框架应用共用同一张表） */
export function httpStatusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
