/** 统一错误中间件：任何抛错 → {error:{code,message,context?}} + httpStatusFor */
import type { Middleware } from 'koa';
import { httpStatusFor } from '@rebased/contracts';
import { toServiceError } from '@rebased/api';

export const errorHandler: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    const serviceError = toServiceError(error);
    ctx.status = httpStatusFor(serviceError.code);
    ctx.body = { error: { code: serviceError.code, message: serviceError.message, ...(serviceError.context ? { context: serviceError.context } : {}) } };
  }
};
