/** 统一错误中间件：任何抛错（含 bodyparser 层）→ 交给 handleApiError 这一处出口映射 */
import type { Middleware } from 'koa';
import { handleApiError } from '../server-context';

export const errorHandler: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    // 与路由内 try/catch 共用同一出口：ZodError / 请求体解析失败 → 400，其余按 toServiceError
    handleApiError(error, ctx);
  }
};
