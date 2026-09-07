/** 客户端 HTTP：同源 /api；非 2xx 解析 {error:{code,message,context?}} → ServiceError（context 透传，如 AUTH_FAILED 的 host） */
import { ServiceError } from '@rebased/contracts';

/** 非 2xx 响应 → ServiceError：解析 {error:{code,message,context?}}；响应非 JSON 时兜底 GIT_ERROR + HTTP 状态码 */
async function toServiceError(res: Response): Promise<ServiceError> {
  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string; context?: unknown };
  } | null;
  return new ServiceError(
    (body?.error?.code ?? 'GIT_ERROR') as never,
    body?.error?.message ?? `HTTP ${res.status}`,
    // context 仅服务端携带时透传（如 AUTH_FAILED 的 {host}），保持 undefined 语义不引入空值
    ...(body?.error?.context !== undefined ? [{ context: body.error.context }] : []),
  );
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await toServiceError(res);
  return res.json() as Promise<T>;
}

/** POST JSON：请求体序列化 + 非 2xx 错误映射同 getJson */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toServiceError(res);
  return res.json() as Promise<T>;
}

/** PUT JSON：请求体序列化 + 非 2xx 错误映射同 getJson */
export async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toServiceError(res);
  return res.json() as Promise<T>;
}

/** DELETE：无请求体；非 2xx 错误映射同 getJson（响应体契约化——如 {ok:true}） */
export async function delJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw await toServiceError(res);
  return res.json() as Promise<T>;
}
