/** 客户端 HTTP：同源 /api；非 2xx 解析 {error:{code,message}} → ServiceError */
import { ServiceError } from '@rebased/contracts';

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ServiceError((body?.error?.code ?? 'GIT_ERROR') as never, body?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** POST JSON：请求体序列化 + 非 2xx 错误映射同 getJson */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const resBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ServiceError((resBody?.error?.code ?? 'GIT_ERROR') as never, resBody?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** PUT JSON：请求体序列化 + 非 2xx 错误映射同 getJson */
export async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const resBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ServiceError((resBody?.error?.code ?? 'GIT_ERROR') as never, resBody?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
