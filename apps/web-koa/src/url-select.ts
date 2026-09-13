/**
 * 日志页「选中提交」的 URL 读写规则：选中态以 URL（?select=<hash>）为唯一真源——
 * 刷新、复制链接、前进/后退都回到同一选中，容器不再另持一份 state（两份状态必然在某个时序上不一致）。
 * （与 web-next src/url-select.ts 同构；apps 间互禁边界故各持一份。）
 * 入参允许两种形态：web-koa 的 URLSearchParams，web-next 的 searchParams 记录（值可能是数组）。
 */
/** 查询参数形态：URLSearchParams（react-router）或 Next searchParams 记录（同名参数重复时为数组） */
export type UrlQuery = URLSearchParams | Record<string, string | string[] | undefined>;

/** 记录形态取值：同名参数重复时取第一个（与 URLSearchParams.get 一致），缺省为 undefined */
function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 记录形态转 URLSearchParams：undefined 跳过不落键，数组按键重复展开 */
function toSearchParams(query: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

/**
 * 读单个查询参数：缺省与空串（`?x=`）都归一为 null；同名参数重复时取第一个（同 URLSearchParams.get）。
 * 归一在读取处做一次，容器与 UI 便只需判 null，不必各自重复「空串也算没值」。
 */
export function readParam(query: UrlQuery, name: string): string | null {
  const raw = query instanceof URLSearchParams ? query.get(name) : firstOf(query[name]);
  return raw === undefined || raw === '' ? null : raw;
}

/** 读选中提交（= readParam(query, 'select')）：null 表示未选中 */
export function readSelect(query: UrlQuery): string | null {
  return readParam(query, 'select');
}

/**
 * 把选中提交写进查询串，返回**新的** URLSearchParams（不改动入参，容器可能仍在用原对象）。
 * hash 为 null/空串时删除 select（取消选中）；其余查询参数（如 ?compare=）原样保留。
 * 选中项由行点击驱动、且不产生新的浏览步骤，故调用方一律以 replace 语义落到历史里。
 */
export function withSelectParam(query: UrlQuery, hash: string | null): URLSearchParams {
  const next = query instanceof URLSearchParams ? new URLSearchParams(query) : toSearchParams(query);
  if (hash === null || hash === '') next.delete('select');
  else next.set('select', hash);
  return next;
}
