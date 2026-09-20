/**
 * 逐项偏好记忆（localStorage）：把「用户在这一页调过的每个显示选项」各自存一个键，
 * 刷新、关掉再打开、**新开标签页**都按最后一次要求还原（用户口径）。
 *
 * 为什么不放在 URL：这些是**个人显示偏好**（怎么读差异），不是「在看什么」——同一份链接发给别人时
 * 不该把自己的并排/换行偏好一起带过去（与 ?select= / ?file= 那类视图状态的分工见 apps 的 url-select）。
 * 与 useStoredWidth（列宽记忆，原 log-page 的私有实现）同一套口径：读不到 / 越界 / 隐私模式一律回落默认值，绝不抛错。
 *
 * 每个键一个 parse：存量值可能来自旧版本、也可能被手改过，解析不出来就回落 seed——
 * 把「值域校验」交给调用方一处表达（枚举、布尔、数值区间各不相同），读取路径统一。
 */
import { useCallback, useState } from 'react';

/** 单个偏好键在本机的读取：无 window（SSR）/ 存储不可用 / 无值 / 解析失败 → seed */
export function readStoredPreference<T>(key: string, seed: T, parse: (raw: string) => T | null): T {
  if (typeof window === 'undefined') return seed;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? seed : parse(raw) ?? seed;
  } catch {
    // 隐私模式 / 禁用存储 / 分区隔离：读不到就用默认值，不影响功能
    return seed;
  }
}

/**
 * 偏好状态：初值取本机存量值（没有则 seed），更新即写回 localStorage。
 * 写入失败（配额 / 禁用）不抛错——本次会话内的改动仍然生效，只是记不住。
 */
export function useStoredPreference<T>(
  key: string,
  seed: T,
  parse: (raw: string) => T | null,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readStoredPreference(key, seed, parse));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // 写不进去：本次会话内仍然生效
      }
    },
    [key],
  );
  return [value, update];
}

/** 布尔偏好的解析器（存 'true' / 'false'）：非这两个值即视为无效 → 回落 seed */
export function parseBoolean(raw: string): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

/**
 * 数值偏好的状态（列宽这类「夹在区间里的整数」）：与 useStoredPreference 同一套读写口径，
 * 额外把值**夹紧到 [min, max] 并取整**——存量值可能来自旧版本的范围、也可能被手改过，
 * 越界一律夹回，不让它把布局撑坏（原 log-page 的私有 useStoredWidth 逐字搬来，行为不变）。
 */
export function useStoredWidth(
  key: string,
  seed: number,
  min: number,
  max: number,
): [number, (next: number) => void] {
  const [width, setWidth] = useState<number>(() => {
    const stored = readStoredPreference(key, seed, (raw) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    });
    return Math.min(max, Math.max(min, stored));
  });
  const update = useCallback(
    (next: number) => {
      const clamped = Math.min(max, Math.max(min, Math.round(next)));
      setWidth(clamped);
      try {
        window.localStorage.setItem(key, String(clamped));
      } catch {
        // 写不进去（配额 / 禁用存储）：本次会话内的宽度仍然生效
      }
    },
    [key, min, max],
  );
  return [width, update];
}
