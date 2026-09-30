/**
 * 日志页「选中提交 + 两个就地面板」的 URL 读写规则。真源一律是 URL——
 * 刷新、复制链接、前进/后退都回到同一视图，容器不再另持一份 state（两份状态必然在某个时序上不一致）。
 * （与 web-koa src/url-select.ts 同构；apps 间互禁边界故各持一份。）
 * 入参允许两种形态：web-koa 的 URLSearchParams，web-next 的 searchParams 记录（值可能是数组）。
 *
 * 共三个参数，其中两个是**各自独立的就地面板键**（用户口径：两个功能独立开关显隐、互不代劳）：
 *   · `select=<commitHash>` —— 选中的提交（两个面板看的都是这一版；详情面板展示它）
 *   · `browse[=<路径>]`     —— 「浏览快照」：**键在即面板开**
 *   · `diff[=<路径>]`       —— 「变更集」：**键在即面板开**
 *   · 另有 `?compare=` 等由别的功能读写的参数，一律原样保留。
 *
 * **键在即开、值承载定位**（E-empty，2026-09-17 用户口径）——每个键只有一条规则：
 *   · 缺键                → 该面板关着（不发请求、不出那一族标签）
 *   · `?browse=a.ts`      → 开着，且 a.ts 的文件内容标签在前台
 *   · `?browse=`（空值）  → 开着，且**聚合标签**在前台（树 / 变更集清单）
 * 为什么不像早先那样用 `?browse=1` 当「开着」的哨兵：那样同一个键里就同时住着「哨兵值」和「路径值」，
 * 而**文件是可以叫 `1` 的**（`1`、`src/1` 都是合法文件名）——一旦还需要表达「开着但不在前台」，
 * `?browse=1` 就会同时有两个解释。空值把两种角色分开：**聚合标签用空值，路径槽永远只放真路径**，
 * 于是「名为 1 的文件」与「树在前台」永不冲突（`?browse=1` 恒指那个文件）。
 * 代价是读侧必须能区分「键不存在」与「键在但值为空」——这正是 {@link readPanelPath} 的三态返回值。
 * 旧写法 `?snap=<hash>` 只作**只读兼容**（读到即改写成新形态，见 {@link withMigratedSnapshot}），
 * 应用自己不再写出该参数，也不再写出 `?file=`（它被两个面板键各自吸收）。
 */
import type { HistoryViewKey } from '@rebased/ui';

/** 查询参数形态：URLSearchParams（react-router）或 Next searchParams 记录（同名参数重复时为数组） */
export type UrlQuery = URLSearchParams | Record<string, string | string[] | undefined>;

/** 两个就地面板在 URL 里的键名（也是各自标签族的名字） */
export type PanelKey = 'browse' | 'diff';

/**
 * 「聚合标签在前台」的写法：键在、值为空串（`?browse=` / `?diff=`）。
 * 单独导出成一个常量，是为了调用点写 `withBrowsePanel(q, PANEL_AGGREGATE)` 时**意图自明**——
 * 直接写 `null` 读起来像「清空/关闭」，而关闭是另一种写法（整个键删掉）。
 */
export const PANEL_AGGREGATE = null;

/** 记录形态取值：同名参数重复时取第一个（与 URLSearchParams.get 一致），缺省为 undefined */
function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 记录形态转 URLSearchParams：undefined 跳过不落键，数组按键重复展开（空串照样落成 `k=`） */
function toSearchParams(query: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

/** 入参归一为可写的 URLSearchParams（不改动入参：调用方可能仍在用原对象） */
function copyOf(query: UrlQuery): URLSearchParams {
  return query instanceof URLSearchParams ? new URLSearchParams(query) : toSearchParams(query);
}

/**
 * 读单个查询参数：缺省与空串（`?x=`）都归一为 null；同名参数重复时取第一个（同 URLSearchParams.get）。
 * 归一在读取处做一次，容器与 UI 便只需判 null，不必各自重复「空串也算没值」。
 * **面板键不要用这个读**——对它们来说空值是有意义的值（见 {@link readPanelPath}）。
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
  const next = copyOf(query);
  if (hash === null || hash === '') next.delete('select');
  else next.set('select', hash);
  return next;
}

/**
 * 读一个面板键的**定位**（三态，这是本模块最容易搞错的一处，务必按返回值分支）：
 *   · `undefined` —— 键不存在 = 该面板**关着**
 *   · `null`      —— 键在、值为空 = 面板开着，且**聚合标签**在前台（树 / 变更集清单）
 *   · `string`    —— 键在、有值 = 面板开着，且**该路径**在前台（文件内容标签 / 差异标签）
 * 三态而不是两态，是因为「关着」与「开着但停在聚合标签上」是两件不同的事（前者不渲染、后者渲染）。
 */
export function readPanelPath(query: UrlQuery, panel: PanelKey): string | undefined | null {
  if (query instanceof URLSearchParams) {
    if (!query.has(panel)) return undefined;
    const value = query.get(panel) ?? '';
    return value === '' ? null : value;
  }
  const raw = query[panel];
  if (raw === undefined) return undefined;
  const value = firstOf(raw) ?? '';
  return value === '' ? null : value;
}

/** 读「浏览快照」面板的定位：undefined = 面板关着；null = 树在前台；字符串 = 该文件在前台 */
export function readBrowsePath(query: UrlQuery): string | undefined | null {
  return readPanelPath(query, 'browse');
}

/** 读「变更集」面板的定位：undefined = 面板关着；null = 变更集清单在前台；字符串 = 该差异在前台 */
export function readChangesPath(query: UrlQuery): string | undefined | null {
  return readPanelPath(query, 'diff');
}

/** 读「浏览快照」键在不在（= 面板开不开）：与定位无关，`?browse=` 同样算开 */
export function readBrowse(query: UrlQuery): boolean {
  return readPanelPath(query, 'browse') !== undefined;
}

/** 读「变更集」键在不在（= 面板开不开） */
export function readChanges(query: UrlQuery): boolean {
  return readPanelPath(query, 'diff') !== undefined;
}

/**
 * 写一个面板键，返回**新的** URLSearchParams（不改动入参）：
 *   · `path === null`（= PANEL_AGGREGATE）→ 键在、值为空：面板开着且聚合标签在前台
 *   · `path` 为字符串                     → 键为该路径：面板开着且该路径在前台
 *   · `path === null` 且要**关闭**时用 {@link withPanelClosed}（语义不同，别混）
 * 只动自己这一个键，另一个面板键与其它参数（?compare= 等）原样保留。
 */
function withPanel(query: UrlQuery, panel: PanelKey, path: string | null): URLSearchParams {
  const next = copyOf(query);
  next.set(panel, path ?? '');
  return next;
}

/** 关掉一个面板（删键），另一个面板键与其它参数不受影响 */
function withPanelClosed(query: UrlQuery, panel: PanelKey): URLSearchParams {
  const next = copyOf(query);
  next.delete(panel);
  return next;
}

/** 写「浏览快照」面板：`withBrowsePanel(q, 'a.ts')` = 面板开且该文件在前台；`withBrowsePanel(q, PANEL_AGGREGATE)` = 树在前台 */
export function withBrowsePanel(query: UrlQuery, path: string | null): URLSearchParams {
  return withPanel(query, 'browse', path);
}

/** 写「变更集」面板：`withChangesPanel(q, 'b.ts')` = 面板开且该差异在前台；`withChangesPanel(q, PANEL_AGGREGATE)` = 清单在前台 */
export function withChangesPanel(query: UrlQuery, path: string | null): URLSearchParams {
  return withPanel(query, 'diff', path);
}

/** 关掉「浏览快照」面板（删 `browse` 键） */
export function withoutBrowsePanel(query: UrlQuery): URLSearchParams {
  return withPanelClosed(query, 'browse');
}

/**
 * 把快照文件标签的视图一并清掉（删 `view` 键，其余参数原样保留）。
 * 用途只有一个：**关掉「浏览快照」面板时**调用——`view` 描述的是「那个面板里看文件的哪一种内容」，
 * 面板都收起了它就没有了描述对象；留着会在下一次打开面板（甚至另一个页面读同名键）时凭空生效。
 * 注意别拿它去关「变更集」面板：那个面板的差异标签不读 `view`，误删只会把用户刚选的视图偏好弄丢。
 */
export function withoutSnapshotFileView(query: UrlQuery): URLSearchParams {
  const next = copyOf(query);
  next.delete('view');
  return next;
}

/** 关掉「变更集」面板（删 `diff` 键） */
export function withoutChangesPanel(query: UrlQuery): URLSearchParams {
  return withPanelClosed(query, 'diff');
}

/** 差异标签族（`open` = 已开顺序，`active` = 前台项；'' = 清单在前台）——容器持有的会话状态 */
export interface DiffTabsState {
  open: string[];
  active: string;
}

/**
 * 首帧初值：从 URL 的 `diff` 键造出差异标签族状态。
 * 「已打开」在 URL 里表达不出来（那是会话态），故只把**前台项**那一格补进 `open`——
 * 这样标签栏里真的有这个标签可激活，也不会出现「active 指着一个没开的标签」这种自相矛盾的状态。
 */
export function diffTabsFromUrl(query: UrlQuery): DiffTabsState {
  const activePath = readChangesPath(query);
  return typeof activePath === 'string' ? { open: [activePath], active: activePath } : { open: [], active: '' };
}

/**
 * 地址变化后把差异定位灌进标签族状态（浏览器前进/后退、外部改地址、**以及首帧的深链**——
 * Next 的 useSearchParams 首次渲染可能还是空的，故不能只在 useState 初值里读一次 URL）：
 *   · `?diff=<路径>` → 开成激活标签（已开则只切过去）
 *   · `?diff=`（聚合）→ 前台回清单，但**已开标签全部留着**（地址栏只表达「哪个在前台」，不代表关标签）
 * 键不在（面板关着）时原样返回：那一族的收摊由容器点开关时负责，这里不替它做决定。
 */
export function syncDiffTabsWithUrl(prev: DiffTabsState, query: UrlQuery): DiffTabsState {
  const activePath = readChangesPath(query);
  if (typeof activePath === 'string') {
    if (prev.active === activePath && prev.open.includes(activePath)) return prev;
    return { open: prev.open.includes(activePath) ? prev.open : [...prev.open, activePath], active: activePath };
  }
  if (activePath === null) return prev.active === '' ? prev : { open: prev.open, active: '' };
  return prev;
}

/**
 * 地址里是否有**旧形态**的快照参数（`?snap=`，不论取值——旧写法里它可能是空串，那时只表示「开」）。
 * 容器据此只跑一次改写；判空值不行，必须判键在不在（同 {@link readPanelPath} 的理由）。
 */
export function isLegacySnapshotUrl(query: UrlQuery): boolean {
  return query instanceof URLSearchParams ? query.has('snap') : query.snap !== undefined;
}

/**
 * 旧深链 `?snap=<hash>[&file=<路径>]` 的一次性改写，返回**新的** URLSearchParams（不改动入参）：
 *   · 删掉 `snap`（新形态里没有这个键，也不再有第三种写法）
 *   · `select` 缺失时用 `snap` 的版本号补上（旧链接里两者本就是同一个提交）
 *   · 有 `file=` 时改写成 `browse=<该路径>`（旧链接「这一版 + 这个文件」的语义原样保留），
 *     没有时改写成 `browse=`（旧链接的语义就是「面板开着」，落点是树）
 *   · `file` 一并删除（它已被两个面板键各自吸收），其余参数（?compare= 等）原样保留
 * 不是旧形态时原样返回，绝不改动 `select` / `browse` / `diff`。
 */
export function withMigratedSnapshot(query: UrlQuery): URLSearchParams {
  const next = copyOf(query);
  if (!next.has('snap')) return next;
  const legacySnap = next.get('snap') ?? '';
  next.delete('snap');
  if (legacySnap !== '' && (next.get('select') ?? '') === '') next.set('select', legacySnap);
  const legacyFile = next.get('file');
  next.delete('file');
  return withBrowsePanel(next, legacyFile === null || legacyFile === '' ? PANEL_AGGREGATE : legacyFile);
}

/**
 * 快照栏**文件标签的视图**（`/repos/:id` 右栏，路径栏那两个图标按钮切换）。
 * 三个值各是一件事，且都是「看这个文件的哪一种内容」——文件内容本身（plain，缺省）/ 逐行注解 / 与最新版本差异。
 * 与历史页的 `view` 键**同名**：语义都是「右栏前台看哪一个视图」，只是取值域各自受限
 * （历史页见 {@link readHistoryView}）。空值/非法值一律回落 `plain`——地址被手改也不至于渲染出没有的视图。
 */
export type SnapshotFileView = 'plain' | 'annotate' | 'latest';

/** 读快照文件标签的视图：缺省、空值与非法值一律 `plain`（缺省视图不写进地址，但读到空也要给一个确定值） */
export function readSnapshotFileView(query: UrlQuery): SnapshotFileView {
  const raw = readParam(query, 'view');
  return raw === 'annotate' || raw === 'latest' ? raw : 'plain';
}

/**
 * 写快照文件标签的视图（只动 `view` 一个键，其余参数原样保留）。
 * `plain` 是缺省视图 → **删键**而不是写 `view=plain`：地址里只留用户显式做过的选择，
 * 「恢复原样」与「从没切过」于是是同一种地址，刷新与复制链接都不会带上一条无信息量的参数。
 */
export function withSnapshotFileView(query: UrlQuery, view: SnapshotFileView): URLSearchParams {
  const next = copyOf(query);
  if (view === 'plain') next.delete('view');
  else next.set('view', view);
  return next;
}

/**
 * 历史页（`/repos/:id/history`）三栏工作台的参数读写。三个键各管一件事：
 *   · `file=<路径>`                  —— 归属目标（与 /diff 同名同义）
 *   · `select=<完整哈希>`            —— 中栏选中的提交（右栏三标签看的都是它）
 *   · `view=changes|latest|annotate|detail` —— 右栏在前台的标签（`detail` = 提交详情）
 * 缺省不写进地址：`?select=` 缺失时容器派生「该文件最新一条」，`?view=` 缺失即 `changes`；
 * 只有用户显式动作才落参数（与日志页「URL 是真源、交互一律 replace」同一口径）。

 */
export function readHistoryFile(query: UrlQuery): string {
  return readParam(query, 'file') ?? '';
}

/** 读右栏标签：缺省与非法值一律回落 `changes`（地址被手改也不至于渲染出一个不存在的标签） */
export function readHistoryView(query: UrlQuery): HistoryViewKey {
  const raw = readParam(query, 'view');
  return raw === 'latest' || raw === 'annotate' || raw === 'detail' || raw === 'changes' ? raw : 'changes';
}

/**
 * 规范化历史页查询串（幂等，返回**新的** URLSearchParams）：
 *   · `rev=` 残键 → 直接删（旧历史页「Annotate」的深链随该页一并撤销，参数不再有语义）；
 *   · `view=` 非法值 → 写成 `changes`（读侧虽也回落，但地址里留个看不懂的值没有意义）；
 *   · `file=` / `select=` 空值 → 删键（空串不是有效定位，留着只会让「有没有值」两种写法各解释一遍）。
 * 其余参数（?compare= 等）原样保留。
 */
export function normalizeBlameQuery(query: UrlQuery): URLSearchParams {
  const next = copyOf(query);
  if (next.has('rev')) next.delete('rev');
  if (next.has('file') && (next.get('file') ?? '') === '') next.delete('file');
  if (next.has('select') && (next.get('select') ?? '') === '') next.delete('select');
  if (next.has('view')) {
    const view = next.get('view') ?? '';
    if (view !== 'changes' && view !== 'latest' && view !== 'annotate' && view !== 'detail') next.set('view', 'changes');
  }
  return next;
}

/** 换归属文件：写 `file`，**删掉 `select`**（选中回落该文件最新一条），`view` 保留（用户的视角偏好不该被换文件重置） */
export function withHistoryFile(query: UrlQuery, file: string): URLSearchParams {
  const next = copyOf(query);
  next.set('file', file);
  next.delete('select');
  return next;
}

/** 选中提交：hash 为 null/空串时删键（取消选中）；其余参数原样保留 */
export function withHistorySelection(query: UrlQuery, hash: string | null): URLSearchParams {
  const next = copyOf(query);
  if (hash === null || hash === '') next.delete('select');
  else next.set('select', hash);
  return next;
}

/** 切右栏标签：只动 `view` 一个键 */
export function withHistoryView(query: UrlQuery, view: HistoryViewKey): URLSearchParams {
  const next = copyOf(query);
  next.set('view', view);
  return next;
}
