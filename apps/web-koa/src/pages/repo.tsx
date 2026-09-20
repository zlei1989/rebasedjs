/**
 * 日志页容器：useLogPage（分页快照）+ useLogStream（SSE 渐进式渲染）+ useRepoStatus + useRepoEvents（状态推送）
 * 注入 ui LogPage（与 web-next 容器同构；repoId 取 useParams 而非 Next params）。
 * 流式语义（Ruling 6）：stream 是同一查询的渐进式渲染而非快照后的新增，
 * 故 commits 经 mergeLogCommits 合成——流连接中以流为主列表，REST 快照作首屏与 hash 去重兜底。
 * 选中提交以 URL（?select=<hash>）为唯一真源（见 src/url-select.ts）：行点击 replace 写 URL，
 * 刷新/深链/前进后退都回到同一选中；目标不在已加载窗口内时有界补页（SELECT_RESTORE_MAX_PAGES）。
 * 远程操作区：顶栏「更多」入口（变基/标签/拉取/推送/更新项目/远程管理/补丁/搁置/控制台/忽略）+ pull/push/update 对话框（页面化 Modal 不如对话框内联——Java 版即为对话框）。
 * 变基区：RebaseDialog 双模式状态机——简单模式 → useRebase；交互模式 → base 本地状态驱动
 * useRebaseTodo 重取（onBaseChange）+ useInteractiveRebase 提交；结果 success → 提示关闭（events 推送刷新日志）；
 * conflicts → 警告 + 跳冲突页（操作态经 events 推送，conflicts 页自行加载）。
 * 摘樱桃/还原区：CommitDetailsPanel 回调 → 容器 Modal.confirm 确认 → useCherryPick/useRevert；
 * 结果 conflicts → 警告 + 跳冲突页。
 * AuthDialog 全局于本容器（认证重试回路范式，后续页面需要认证的远程操作复用此装配）：
 * 操作失败 err instanceof ServiceError 且 code==='AUTH_FAILED' → 开 AuthDialog（host 自 err.context）
 * → onOk = upsertAccount({host, account, token}) → 成功后重试原操作一次；取消即放弃。
 */
import {
  useAbortOperation,
  useAutosquash,
  useBranches,
  useBranchAction,
  useBrowseContent,
  useBrowseTree,
  useCherryPick,
  useCheckout,
  useCommitEdit,
  useCommitFiles,
  useFileDiff,
  useGithubStatus,
  useGitlabStatus,
  useInteractiveRebase,
  useLogPage,
  useLogPages,
  useLogStream,
  useOperation,
  usePull,
  usePush,
  useRebase,
  useRebaseTodo,
  useRecentRepos,
  useRemotes,
  useRepoEvents,
  useRepoStatus,
  useReset,
  useRevert,
  useTagAction,
  useUndoCommit,
  useUpdateProject,
  useUpsertAccount,
} from '@rebased/client';
import {
  ServiceError,
  type CommitInfo,
  type InteractiveRebaseBody,
  type PickOutcome,
  type PullBody,
  type PushBody,
  type RebaseBody,
  type RebaseOutcome,
  type ResetBody,
  type UpdateBody,
  type UpdateOutcome,
} from '@rebased/contracts';
import { AuthDialog, BranchCompareView, LogPage, PullDialog, PushDialog, RebaseDialog, ResetDialog, UpdateProjectDialog } from '@rebased/ui';
import { Modal, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { mergeLogCommits } from '../log-merge';
import {
  diffTabsFromUrl,
  isLegacySnapshotUrl,
  PANEL_AGGREGATE,
  readBrowse,
  readBrowsePath,
  readChanges,
  readParam,
  readSelect,
  syncDiffTabsWithUrl,
  withBrowsePanel,
  withChangesPanel,
  withMigratedSnapshot,
  withSelectParam,
  withoutBrowsePanel,
  withoutChangesPanel,
} from '../url-select';

/**
 * 恢复 URL 选中项的自动补页上限：页大小阶梯 50→100→200→400→500（见 useLogPages），
 * 6 页 ≈ 最早 1750 条提交。到上限即放弃（陈旧 hash 不把整个历史翻到底），代价是该提交仍不可见。
 */
const SELECT_RESTORE_MAX_PAGES = 6;

/** 面板定位的三种意图：路径 = 该路径在前台；`PANEL_AGGREGATE`（null）= 开着但聚合标签在前台；'skip' = 这个键不动 */
type PanelIntent = string | typeof PANEL_AGGREGATE | 'skip';

/** 意图 → 写入后的查询串（'skip' 原样返回，其余交给 url-select 的两个写函数） */
const applyPanel = (query: URLSearchParams, panel: 'browse' | 'diff', intent: PanelIntent): URLSearchParams => {
  if (intent === 'skip') return query;
  return panel === 'browse' ? withBrowsePanel(query, intent) : withChangesPanel(query, intent);
};

export function RepoPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  // 日志页 URL 参数（选中提交 / 分支对比）：选中态的唯一真源就是这里的 ?select=<hash>——行点击写 URL、
  // 刷新与前进后退从 URL 读回（原「useState 只在首帧初始化」的写法刷新即丢选中，见 src/url-select.ts）。
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedHash = readSelect(searchParams);
  // === 就地面板：两个**独立开关**（详情面板「浏览快照」/「查看变更集」）===
  // 两个开关的真源都在 URL，且**键在即开、值承载定位**（见 src/url-select.ts）：
  //   · `browse` 键在 = 「浏览快照」开着；缺键 = 关着
  //   · `diff`   键在 = 「查看变更集」开着；缺键 = 关着
  //   · 值时：路径 = 该文件/该差异在前台；空值 = **聚合标签**（文件树 / 变更集清单）在前台
  // 两个面板看的都是 selectedHash 那一版，故 URL 里不再需要版本号参数
  // （原 `?snap=<hash>` 与 `?file=` 已降级为只读兼容，见下面的旧链接改写）。
  const browseOn = readBrowse(searchParams);
  const changesOn = readChanges(searchParams);
  // 三态 → 两态的容器内翻译：`?browse=`（开着但停在树上）就是「没有选中的文件」，
  // 故与「关着」一样给 undefined——上层（LogPage/SnapshotTabs）只认「哪个文件被选中」，不必知道三态。
  const browsePath = readBrowsePath(searchParams);
  const browseSelectedFile = browsePath === undefined || browsePath === null ? undefined : browsePath;
  // 旧深链改写（`?snap=<hash>`）：一次性把地址换成新形态（browse，并沿用那个版本号做选中提交）
  const legacySnapRef = useRef(false);
  // 分支对比视图（?compare=<branch>，GitCompareWithBranchAction 语义）：双 range 查询
  // current..branch（分支独有）与 branch..current（当前独有）；status readiness 由下方守卫保证。
  const compareBranch = readParam(searchParams, 'compare');
  // 过滤/按需分页（P2 收取）：author/path 过滤（文本即滤，对齐 Java）；分页走 useLogPages 的累积页
  // （页大小 50→100→200→400→500 阶梯，skip 逐页累加），滚到列表底部自动追加下一页，
  // 直到服务端回报 hasMore=false —— 也就是仓库第一条提交进了列表（此前写死 500 上限，超过 500 条
  // 提交的仓库永远看不到最早一条）。
  // 过滤或翻页会改变查询语义——此时流（Ruling 6 同查询渐进渲染）与快照不再同查询，故仅默认视图
  // （无过滤且只加载了第一页）接入流合并
  const [author, setAuthor] = useState('');
  const [path, setPath] = useState('');
  // 分支过滤选中项：非空时把日志查询切到 --all —— 否则被过滤掉的提交不在数据里，
  // 过滤就没有可隐藏的对象（设计 §2.2）
  const [branchFilter, setBranchFilter] = useState<string[]>([]);
  // 分支过滤可选项：复用既有分支端点（GET /api/repos/:id/branches），无新增端点
  const { data: branchList } = useBranches(repoId);
  const {
    commits: pageCommits,
    hasMore: logHasMore,
    loadingMore: loadingMoreLog,
    loadMore: loadMoreLog,
    reset: resetLogPages,
    size: logPageCount,
    mutate: mutateLog,
    isLoading: logInitialLoading,
  } = useLogPages(repoId, {
    ...(author === '' ? {} : { author }),
    ...(path === '' ? {} : { path }),
    ...(branchFilter.length === 0 ? {} : { all: true }),
  });
  // 分支过滤激活时数据源是 --all（多分支的全量历史），流是「仅 HEAD 可达提交」的渐进渲染，
  // 两者不是同一查询——并进窗口会把只属于 HEAD 的流式提交混进全分支页，故一并算进 streamEnabled
  const streamEnabled = author === '' && path === '' && branchFilter.length === 0 && logPageCount === 1;
  const [refreshKey, setRefreshKey] = useState(0);
  const { commits: streamCommits, connected: streamConnected, error: streamError } = useLogStream(repoId, refreshKey);
  const { data: status, mutate } = useRepoStatus(repoId);
  // 分支对比双 range 查询（status 就绪后才有 current 分支名；未就绪/无 compare 挂空 key 不发请求）
  const compareRangeA = compareBranch !== null ? `${status?.branch ?? 'HEAD'}..${compareBranch}` : null;
  const compareRangeB = compareBranch !== null ? `${compareBranch}..${status?.branch ?? 'HEAD'}` : null;
  const { data: compareA } = useLogPage(compareRangeA === null ? '' : repoId, {
    ...(compareRangeA === null ? {} : { range: compareRangeA }),
    limit: 500,
  });
  const { data: compareB } = useLogPage(compareRangeB === null ? '' : repoId, {
    ...(compareRangeB === null ? {} : { range: compareRangeB }),
    limit: 500,
  });
  // GitHub 面板可用性：检测到 GitHub 远程才给 LogPage 注入入口（对齐 Java 行为）；失败静默隐藏（渐进增强）
  const { data: githubStatus } = useGithubStatus(repoId);
  // GitLab 面板可用性：与 GitHub 并排、各自检测（容器经 useGitlabStatus 判定菜单项显隐）
  const { data: gitlabStatus } = useGitlabStatus(repoId);
  const { data: operation, mutate: mutateOperation } = useOperation(repoId);
  const { trigger: abortOperation, isMutating: abortingOperation } = useAbortOperation(repoId);
  const { trigger: resetTrigger, isMutating: resetting } = useReset(repoId);
  const { trigger: undoCommit, isMutating: undoCommitting } = useUndoCommit(repoId);
  // 行右键菜单（Java Vcs.Log.ContextMenu 组）：检出/新建分支/新建标签 mutation + 浏览器打开链接（GitHub/GitLab 提交页）
  const { trigger: checkout, isMutating: checkingOut } = useCheckout(repoId);
  const { trigger: branchAction } = useBranchAction(repoId);
  const { trigger: tagAction, isMutating: tagActing } = useTagAction(repoId);
  // 远程操作区：远程列表（pull/push 对话框数据源）+ pull/push/update 突变 + 账户保存（认证重试回路用）
  const { data: remotes } = useRemotes(repoId);
  const { trigger: pull, isMutating: pulling } = usePull(repoId);
  const { trigger: push, isMutating: pushing } = usePush(repoId);
  const { trigger: updateProject, isMutating: updating } = useUpdateProject(repoId);
  const { trigger: upsertAccount, isMutating: savingAccount } = useUpsertAccount();
  // 全局 mutate：onRefs 里重验证分支列表缓存键（本页未挂载 useBranches，仅对已挂载该键的页面生效，如分支页打开期间）
  const { mutate: mutateGlobal } = useSWRConfig();
  // ResetDialog 目标提交（hash + 展示用 label）；null 表示关闭
  const [resetTarget, setResetTarget] = useState<{ hash: string; label: string } | null>(null);
  // pull/push/update 对话框状态机：同一时间只开一个；null 表示全关（对话框内部选择态在关闭时自复位）
  const [openDialog, setOpenDialog] = useState<'pull' | 'push' | 'update' | null>(null);
  // Push up to Commit（#17）：行右键「Push up to Commit」→ 打开 PushDialog 并预置目标提交 hash；null=普通推送
  const [pushUpToHash, setPushUpToHash] = useState<string | null>(null);
  // 查看变更集（#13）：不再是 Modal，而是右栏标签栏里的「变更集（N）」标签——这里是它**看哪一版**的取数键。
  // 开关真源是 URL 的 `?diff=1`（changesOn）；**没有单独的「变更集 hash」状态**：两个面板看的都是
  // 当前选中的提交（`?select=`），开关本身只是一个布尔，故「哪个提交的变更集」= selectedHash，
  // 由 URL 直接派生（容器不再存第二份，刷新/前进后退/换提交都自动对齐）。
  // 深链 `?select=X&diff=` 因此不需要额外的 hash 参数；面板关着时取数为空串（挂 null key 不发请求）。
  const effectiveChangesHash = changesOn ? selectedHash ?? '' : '';
  const { data: changesEntry, isLoading: changesLoading, error: changesError } = useCommitFiles(repoId, effectiveChangesHash);
  // 变更集里的差异标签族（受控）：**必须活在容器里**——标签栏在换提交时会被 key 重挂载（文件树标签据此复位，
  // 旧路径在新版本里未必存在），只有容器持有的这份状态才能让已开差异标签跨过那次重挂载，
  // 再由下面的剪枝按新提交的变更集收敛。
  // 初值取 `?diff=<路径>`（深链直达某个差异标签时首帧就激活它）——「已打开」在 URL 里表达不出来
  // （那是会话态），故只把**前台项**那一格补进 open：这样标签栏里真的有这个标签可激活，
  // 也不会出现「active 指着一个没开的标签」这种自相矛盾的状态。
  const [changesDiff, setChangesDiff] = useState<{ open: string[]; active: string }>(() => diffTabsFromUrl(searchParams));
  // 差异取数两端：以**当前提交的父提交**为 from、当前提交为 to（与差异页定提交对比同口径）；
  // 根提交没有父版本（changesParent 为 undefined）→ 不发请求，标签内只给提示行。
  // entry.hash === effectiveChangesHash 的判据：SWR 换键那一拍可能还挂着上一提交的数据，不能拿去当取数参数。
  const changesEntryReady = changesEntry !== undefined && changesEntry !== null && changesEntry.hash === effectiveChangesHash;
  const changesParent = changesEntryReady ? changesEntry.parents[0] : undefined;
  const {
    data: changesDiffVersions,
    isLoading: changesDiffLoading,
    error: changesDiffError,
  } = useFileDiff(
    repoId,
    changesDiff.active !== '' && changesParent !== undefined ? changesDiff.active : '',
    false,
    changesParent,
    changesEntry?.hash,
  );
  /**
   * 差异标签剪枝（用户口径：换提交时差异标签**保留**，但只在路径仍属于新变更集时才继续看）：
   * 新提交的变更集到位后把已开差异标签收敛到「本次也动过」的那些，路径不在里面的自动关掉——
   * 否则会留下一条「标签还在、看的却是上一版差异」的假标签；被剪掉的恰是激活项时清空激活项
   * （标签栏回落到「变更集」标签，由 ui 的兜底逻辑落位）。
   */
  useEffect(() => {
    const entry = changesEntry;
    if (entry === undefined || entry === null || entry.hash !== effectiveChangesHash) return;
    const allowed = new Set(entry.files.map((f) => f.path));
    setChangesDiff((prev) => {
      const open = prev.open.filter((p) => allowed.has(p));
      const active = prev.active !== '' && allowed.has(prev.active) ? prev.active : '';
      return open.length === prev.open.length && active === prev.active ? prev : { open, active };
    });
  }, [changesEntry, effectiveChangesHash]);
  // 就地面板的数据源：树跟**选中提交**走（两个面板看的是同一版），空串自动挂 null key 不发请求。
  // 复用既有 useBrowseTree/useBrowseContent（容器不另存一份内容，避免与 URL 真源不一致）。
  const { data: browseTree, isLoading: browseTreeLoading, error: browseTreeError } = useBrowseTree(repoId, selectedHash ?? '');
  const { data: browseContent, isLoading: browseContentLoading, error: browseContentError } = useBrowseContent(repoId, selectedHash ?? '', browseSelectedFile ?? '');
  /**
   * 写两个面板进 URL（replace 而非 push：开合与切标签都不产生新的浏览步骤，不该把浏览器历史塞满）。
   * `browsePath` 传 `undefined` = 该键不动；传 `PANEL_AGGREGATE`（null）= 开着但聚合标签在前台；
   * 传字符串 = 该路径在前台；关闭面板请走下面两个 `close*`（删键，与聚合是两件事）。
   */
  /**
   * 写两个面板进 URL（replace 而非 push：开合与切标签都不产生新的浏览步骤，不该把浏览器历史塞满）。
   * 定位用 {@link PanelIntent} 三态表达，`'skip'` 表示这个键不动（另一个面板的状态原样保留）；
   * 关闭面板请走 {@link closePanel}（删键）——它与「聚合标签在前台」是两件不同的事。
   */
  const writePanels = (nextBrowse: PanelIntent, nextChanges: PanelIntent): void => {
    let next = applyPanel(searchParams, 'browse', nextBrowse);
    next = applyPanel(next, 'diff', nextChanges);
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };
  /** 关闭某个面板（删键） */
  const closePanel = (panel: 'browse' | 'diff'): void => {
    setSearchParams(panel === 'browse' ? withoutBrowsePanel(searchParams) : withoutChangesPanel(searchParams), {
      replace: true,
      preventScrollReset: true,
    });
  };
  /**
   * URL → 状态的反向同步：**浏览器前进/后退**（本容器写地址走 replace，故历史里只有深链那些条目）
   * 把差异定位拉回标签族状态。与 web-next 同构（那边还必须覆盖「首帧深链」，见该文件注释）。
   * 幂等由 syncDiffTabsWithUrl 保证：已一致时返回同一个引用，state 相同值不触发重渲染。
   */
  useEffect(() => {
    setChangesDiff((prev) => syncDiffTabsWithUrl(prev, searchParams));
  }, [searchParams]);
  // 认证重试回路状态：待重试的原操作 + 认证目标 host；null 表示 AuthDialog 关闭
  const [authRetry, setAuthRetry] = useState<{ host: string; retry: () => Promise<unknown> } | null>(null);
  // 状态推送（干净提交也使 headHash 变化 → 触发此回调）：回写 status 缓存 + 重验证日志快照 + 重订阅流（新提交出现在新流顶部）；
  // 操作推送（operation.state-changed）：回写 operation 缓存驱动顶栏操作条
  useRepoEvents(repoId, {
    onStatus: (next) => {
      void mutate(next, { revalidate: false });
      void mutateLog();
      setRefreshKey((k) => k + 1);
    },
    onOperation: (next) => void mutateOperation(next, { revalidate: false }),
    // 引用推送（refs.changed：分支/标签/贮藏 建删/移动；首帧为全量基线，空数组=指纹变化但名单未知——watcher 扩展的首个消费方）：
    // 重验证日志快照（ref chips 与图形可达性变化）+ 全局重验证分支列表缓存键（本页未挂载 useBranches；
    // 全局 mutate 仅对已挂载该键的页面生效）。HEAD 切换由 repo.state-changed（onStatus）覆盖，不在此帧。
    // 另需**重订阅 log/stream**（与 onStatus 同手法）：渲染列表走 mergeLogCommits「同 hash 取流」，
    // 流侧那几行是建/删分支**之前**送达的、refs 冻结在当时的值——只重验证 REST 快照拿不回它们，
    // chips 会一直停在旧值直到整页刷新（冒烟 D-39 实测）。
    onRefs: () => {
      void mutateLog();
      void mutateGlobal(`/api/repos/${repoId}/branches`);
      setRefreshKey((k) => k + 1);
    },
  });
  const { data: repos } = useRecentRepos();
  // 上一个 repoId：跨仓库复位 effect 靠它区分「首挂载」（不清 URL 参数——深链/刷新要保住快照栏）
  // 与「真的换了仓库」（必须清掉上一个仓库的 snap/file）
  const previousRepoIdRef = useRef<string | null>(null);
  // stream.error 一次性呈现（Task 7 终审 deferred 接通）：error 置位即断开订阅，effect 仅触发一次
  useEffect(() => {
    if (streamError) void message.error(streamError);
  }, [streamError]);
  const commits = useMemo(
    () =>
      streamEnabled
        ? mergeLogCommits(pageCommits, streamCommits, streamConnected)
        : pageCommits,
    [pageCommits, streamCommits, streamConnected, streamEnabled],
  );
  const selectedCommit: CommitInfo | null = commits.find((c) => c.hash === selectedHash) ?? null;
  // 选中提交（行点击与详情面板内的提交链接）写进 URL：replace 而非 push——选中不产生新的浏览步骤，
  // 连点几十行不该把浏览器历史塞满；prev 展开保留 ?compare= 等其它参数（withSelectParam 不改动入参）。
  const onSelectCommit = (hash: string): void => {
    // 浏览快照开着时跟着换到新提交（详情面板展示的与树浏览的必须是同一版，否则出现「面板写着 A、树里是 B」），
    // 并落回**文件树**（聚合标签）：同一路径在新版本里未必存在，指着它就等于让内容栏显示上一版的旧文本。
    // 关着时**不碰这个键**（`withBrowsePanel` 会把键加上，等于替用户把面板打开——那是「互不代劳」的反面）。
    // 变更集面板的定位由「标签族变化」那一路写（见 onChangesDiffChange），这里不代它写；
    // 已开的差异标签交给下面的剪枝按新提交的变更集收敛（用户口径：只保留本次也动过的那些）。
    const withSelect = withSelectParam(searchParams, hash);
    setSearchParams(browseOn ? withBrowsePanel(withSelect, PANEL_AGGREGATE) : withSelect, {
      replace: true,
      preventScrollReset: true,
    });
  };
  /**
   * 「浏览快照」开关（详情面板按钮）：开着再点即收起。它**只管自己这一族标签**（文件树 + 文件内容）——
   * 变更集那一族不受它影响；两族共用一条右栏，故变更集开着时收起文件树，右栏仍在（栏内只剩变更集标签）。
   */
  const onBrowse = (): void => {
    // 开着 → 关（删 browse 键）；关着 → 开且落在文件树上（聚合标签）。diff 键一律不动（互不代劳）
    if (browseOn) closePanel('browse');
    else writePanels(PANEL_AGGREGATE, 'skip');
  };
  /**
   * 「查看变更集」开关（详情面板按钮）：开着再点即收起（含其差异标签）。
   * 打开时看的就是**当前选中的提交**（`effectiveChangesHash` 由 URL 派生），故深链 `?select=X&diff=`
   * 也能直接落在 X 的变更集清单上。
   */
  const onOpenChanges = (): void => {
    // 开着 → 关（删 diff 键，并把差异标签族一并清空：重开时不该凭空冒出旧标签）
    if (changesOn) {
      closePanel('diff');
      setChangesDiff({ open: [], active: '' });
      return;
    }
    // 关闭态 → 开，且落在**变更集清单**（聚合标签）上；browse 键不动（两开关互不代劳）
    writePanels('skip', PANEL_AGGREGATE);
  };
  /** 关闭变更集标签（标签栏上的 ×）：整个变更集标签族收摊（清单 + 已开差异标签），并写回 URL 开关 */
  const onCloseChanges = (): void => {
    closePanel('diff');
    setChangesDiff({ open: [], active: '' });
  };
  /**
   * 差异标签族变化（切标签 / 开关标签 / 剪枝回落）——**同时把定位写回地址栏**：
   * `?diff=<路径>` = 该差异在前台，`?diff=` = 变更集清单在前台。
   * 这一步是「刷新前后看到的一致」的全部关键：只在「打开文件」时写地址是不够的，
   * 用户切回清单、在已打开的差异标签之间来回切都改变前台项，不写的话刷新就会弹回最后写过的那个差异。
   * 只动 `diff` 键，`browse` 键原样保留（两个面板互不代劳）。
   */
  const onChangesDiffChange = (next: { open: string[]; active: string }): void => {
    setChangesDiff(next);
    writePanels('skip', next.active === '' ? PANEL_AGGREGATE : next.active);
  };
  // 恢复 URL 选中项（刷新/深链场景）：目标提交可能不在已加载窗口内（首屏只拉 50 条）——有界补页把它拉进来。
  // 判据用 REST 快照 pageCommits 而非合并后的 commits：补页只改变快照，流式合并出现的瞬时子集
  // 不该触发补页（冒烟 D-38：详情栏首帧后短暂卸载又回来）。命中快照 / 翻到上限 / 无更早提交即解除。
  const selectInPages = selectedHash !== null && pageCommits.some((c) => c.hash === selectedHash);
  // 待恢复目标：URL 选中值变化（含首帧）时重新武装，命中或放弃即解除（避免反复补页）
  const restoreRef = useRef<{ pages: number } | null>(null);
  useEffect(() => {
    restoreRef.current = selectedHash === null ? null : { pages: 0 };
  }, [selectedHash]);
  useEffect(() => {
    const pending = restoreRef.current;
    if (pending === null) return;
    if (selectInPages) {
      restoreRef.current = null; // 已在窗口内：无需补页
      return;
    }
    // 首屏还在拉 / 已到最早一条 / 追加页在飞：等下一帧再判（loadMore 本身也会挡同页连发）
    if (logInitialLoading === true || !logHasMore || loadingMoreLog) return;
    if (pending.pages >= SELECT_RESTORE_MAX_PAGES) {
      restoreRef.current = null; // 到上限：放弃补页，保持「URL 有 hash、列表无该行」的现状
      return;
    }
    pending.pages += 1;
    loadMoreLog();
  }, [selectInPages, selectedHash, logInitialLoading, logHasMore, loadingMoreLog, loadMoreLog]);
  // 「Reset 到此处」：从 commits 找目标提交生成展示 label（短哈希 + 主题），打开 ResetDialog
  const onResetHere = (hash: string): void => {
    const commit = commits.find((c) => c.hash === hash);
    setResetTarget({ hash, label: commit ? `${commit.shortHash} ${commit.message}` : hash });
  };
  // ResetDialog 确定：触发 reset 突变（响应已回写 status 缓存，events 推送驱动 log 刷新），成功关窗提示
  const onResetOk = (body: ResetBody): void => {
    resetTrigger(body)
      .then(() => {
        setResetTarget(null);
        void message.success('已重置');
      })
      .catch((err: unknown) => void message.error(err instanceof Error ? err.message : String(err)));
  };
  // 撤销最近提交（Popconfirm 在 LogPage 内确认后回调）：成功提示，失败以服务端中文 message 提示
  const onUndoCommit = (): void => {
    undoCommit()
      .then(() => void message.success('已撤销最近提交'))
      .catch((err: unknown) => void message.error(err instanceof Error ? err.message : String(err)));
  };
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection（与 reset/undo 内联 catch 并存）
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // === 变基区（RebaseDialog 双模式状态机）===
  const { trigger: rebase, isMutating: rebasing } = useRebase(repoId);
  const { trigger: interactiveRebase, isMutating: interactiveRebasing } = useInteractiveRebase(repoId);
  // 交互模式基准（'' = 未输入，useRebaseTodo 挂 null key 不发请求）；容器持有 base，UI 输入经 onBaseChange 回写
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const [rebaseBase, setRebaseBase] = useState('');
  // 交互模式 todo 数据源：base 变化自动重取，old-data 期间 ui 以 todoLoading 禁用确定（Task 6 审查防御）；
  // 加载失败（无效 base 等）经 todoError 透传 UI 显式呈现，避免误导性的「无待重放提交」（P3-B 终审）
  const { data: rebaseTodo, isLoading: rebaseTodoLoading, error: rebaseTodoError } = useRebaseTodo(repoId, rebaseBase);
  // 变基结果分派：success → 提示（events 推送 headHash/refs 变化刷新日志）；conflicts → 警告 + 跳冲突页；
  // up-to-date → 提示；任何结果都关闭对话框并复位 base（失败路径同 reset/undo 先例，只提示不关窗——用户可改参重试）
  const dispatchRebaseOutcome = (outcome: RebaseOutcome): void => {
    if (outcome.status === 'conflicts') {
      void message.warning('变基存在冲突，请解决后完成');
      void navigate(`/repos/${repoId}/conflicts`);
    } else if (outcome.status === 'up-to-date') {
      void message.info('已是最新');
    } else {
      void message.success('变基完成');
    }
    setRebaseBase('');
    setRebaseOpen(false);
  };
  const onRebaseOnto = (body: RebaseBody): void => {
    rebase(body).then(dispatchRebaseOutcome).catch(onError);
  };
  const onInteractiveRebase = (body: InteractiveRebaseBody): void => {
    interactiveRebase(body).then(dispatchRebaseOutcome).catch(onError);
  };
  // === auto-squash（GitAutoSquashCommitAction 语义：fixup!/squash! 提交折入选中提交）===
  const { trigger: autosquash } = useAutosquash(repoId);
  const onAutosquash = (action: 'fixup' | 'squash', hash: string): void => {
    Modal.confirm({
      title: action === 'fixup' ? 'Fixup Commit' : 'Squash Commit',
      content: `将以暂存内容创建 ${action}! 提交并折入选中提交（历史将被重写）；无暂存内容请先在状态页暂存`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => autosquash({ hash, action }).then(dispatchRebaseOutcome).catch(onError),
    });
  };
  // === 单提交编辑直通（GitSingleCommitEditingAction 语义：reword/drop/squash/fixup）===
  const { trigger: commitEdit } = useCommitEdit(repoId);
  const ACTION_LABELS: Record<'reword' | 'drop' | 'squash' | 'fixup', string> = {
    reword: '重写提交信息',
    drop: '删除提交（其变更一并丢弃）',
    squash: '并入父提交（提交数 -1，信息合并）',
    fixup: '并入父提交（保留父提交信息，提交数 -1）',
  };
  const onEditCommit = (action: 'reword' | 'drop' | 'squash' | 'fixup', hash: string, message?: string): void => {
    if (action === 'reword') {
      // 信息已由行右键 Modal 收集（message 非空）
      commitEdit({ hash, action, message })
        .then(dispatchRebaseOutcome)
        .catch(onError);
      return;
    }
    Modal.confirm({
      title: `${action === 'drop' ? 'Drop' : action === 'squash' ? 'Squash' : 'Fixup'} Commit`,
      content: `${ACTION_LABELS[action]}（历史将被重写）；冲突时可在冲突页解决`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => commitEdit({ hash, action }).then(dispatchRebaseOutcome).catch(onError),
    });
  };
  // === 摘樱桃/还原区（CommitDetailsPanel 回调 → 容器确认 → hook）===
  const { trigger: cherryPick } = useCherryPick(repoId);
  const { trigger: revert } = useRevert(repoId);
  // pick 结果分派：success → 提示（events 推送 headHash 变化刷新日志）；conflicts → 警告 + 跳冲突页
  const dispatchPickOutcome = (outcome: PickOutcome): void => {
    if (outcome.status === 'conflicts') {
      void message.warning('存在冲突，请解决后完成');
      void navigate(`/repos/${repoId}/conflicts`);
    } else {
      void message.success('操作完成');
    }
  };
  // 摘樱桃/还原：Modal.confirm 确认后调 hook（确认弹窗由容器持有，按钮提示语按操作区分）
  const onCherryPick = (hash: string): void => {
    Modal.confirm({
      title: '摘樱桃',
      content: '确认将选中提交摘到当前分支？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => cherryPick({ hashes: [hash] }).then(dispatchPickOutcome).catch(onError),
    });
  };
  const onRevert = (hash: string): void => {
    Modal.confirm({
      title: '还原',
      content: '确认反转选中提交（生成 Revert 提交）？',
      okText: '确定',
      cancelText: '取消',
      onOk: () => revert({ hashes: [hash] }).then(dispatchPickOutcome).catch(onError),
    });
  };
  /**
   * 远程数据传输操作的公共出口（认证重试回路装配点，范式供后续页面复用）：
   * 成功 → onSuccess 呈现结果；失败且 err 为 ServiceError('AUTH_FAILED') → 关当前对话框、开 AuthDialog
   * （host 自 err.context——服务端 withAuth 抛出时携带 {host}，绝不含 token），retry 闭包持有原操作待重试；
   * 其余错误 → 服务端中文 message 提示
   */
  function runRemoteOp<T>(op: () => Promise<T>, onSuccess: (outcome: T) => void): void {
    op()
      .then(onSuccess)
      .catch((err: unknown) => {
        if (err instanceof ServiceError && err.code === 'AUTH_FAILED') {
          const host = (err.context as { host?: string } | undefined)?.host ?? '';
          setOpenDialog(null);
          setAuthRetry({ host, retry: () => op().then(onSuccess) });
        } else {
          void message.error(err instanceof Error ? err.message : String(err));
        }
      });
  }
  // PullDialog 确定：按结果呈现（成功响应已由事件推送驱动 status/log 刷新，无需手动 mutate）
  const onPullOk = (body: PullBody): void => {
    runRemoteOp(
      () => pull(body),
      (outcome) => {
        setOpenDialog(null);
        if (outcome.status === 'up-to-date') void message.info('已是最新');
        else if (outcome.status === 'updated') void message.success('拉取完成');
        else void message.warning('拉取存在冲突，请解决后完成');
      },
    );
  };
  // PushDialog 确定：rejected 为 200 业务结果（非错误）——#91 联动：记录待重新推的推送体，自动打开 Update 对话框；
  // 其余状态直接分派提示。ref 保存 pendingPush（无需触发重渲染，回调闭包内读取）。
  const pendingPushRef = useRef<PushBody | null>(null);
  const onPushOk = (body: PushBody): void => {
    runRemoteOp(
      () => push(body),
      (outcome) => {
        if (outcome.status === 'rejected') {
          pendingPushRef.current = body;
          setOpenDialog('update');
          void message.warning(outcome.hint ?? '推送被拒绝，请先更新');
        } else {
          setOpenDialog(null);
          if (outcome.status === 'up-to-date') void message.info('已是最新');
          else void message.success('推送完成');
        }
      },
    );
  };
  // UpdateProjectDialog 确定：结果 = fetch 引用数 + pull 状态的组合视图；
  // 若为推送被拒后的更新（pendingPushRef 非空）→ 更新成功（up-to-date/updated）后自动续推原推送体（结果面板不展示——流程闭环）；
  // 常规更新 → 结果面板呈现（对话框保持打开，用户读后关闭）
  const [updateOutcome, setUpdateOutcome] = useState<UpdateOutcome | null>(null);
  const onUpdateOk = (body: UpdateBody): void => {
    const pendingPush = pendingPushRef.current;
    runRemoteOp(
      () => updateProject(body),
      (outcome) => {
        if (outcome.pull.status === 'conflicts') {
          pendingPushRef.current = null;
          setUpdateOutcome(outcome);
          void message.warning('更新存在冲突，请解决后完成');
          return;
        }
        if (pendingPush === null) {
          // 常规更新：结果面板（fetched + pull 汇总）——对话框保持打开，用户读后点「关闭」
          setUpdateOutcome(outcome);
          return;
        }
        // 推送被拒后的续推：update 成功 → 重推 pendingPush；rejected 再次出现则回到 update（用户改策略再试）
        runRemoteOp(
          () => push(pendingPush),
          (pushOutcome) => {
            if (pushOutcome.status === 'rejected') {
              setOpenDialog('update');
              void message.warning(pushOutcome.hint ?? '推送仍被拒绝，请再次更新');
            } else {
              pendingPushRef.current = null;
              setOpenDialog(null);
              if (pushOutcome.status === 'up-to-date') void message.info('已是最新');
              else void message.success('更新并推送完成');
            }
          },
        );
      },
    );
  };
  // AuthDialog 确定（保存并重试）：先 upsertAccount 持久化凭据，成功后重试原操作一次；
  // 重试仍 AUTH_FAILED（凭据可能不对）→ 保持弹窗循环，用户可换凭据再试或取消；其余错误 → 关窗 + 提示
  const onAuthOk = (account: string, token: string): void => {
    const pending = authRetry;
    if (!pending) return;
    upsertAccount({ host: pending.host, account, token })
      .then(() => pending.retry())
      .then(() => setAuthRetry(null))
      .catch((err: unknown) => {
        if (err instanceof ServiceError && err.code === 'AUTH_FAILED') {
          void message.error(err.message);
        } else {
          setAuthRetry(null);
          void message.error(err instanceof Error ? err.message : String(err));
        }
      });
  };
  // 容器态跨仓库复位（§2.5 createOpen 硬化）：仓库切换时清空选择/对话框/认证重试等容器持有的状态——
  // ui 层内嵌 Modal 已由 <LogPage key={repoId}> 重挂载复位，此处兜底容器自身状态（选中提交、push-up-to、打开对话框等）
  useEffect(() => {
    setPushUpToHash(null);
    setOpenDialog(null);
    setRebaseOpen(false);
    setResetTarget(null);
    setAuthRetry(null);
    setUpdateOutcome(null);
    // 变更集「看哪一版」由 URL 派生，这里只需清空差异标签族（开关与选中项由下面的地址改写负责）
    setChangesDiff({ open: [], active: '' });
    setAuthor('');
    setPath('');
    setBranchFilter([]);
    resetLogPages();
    // 就地面板是 URL 真源，故这里改写地址而不是清状态：树与变更集都按 repoId + 选中提交拉，
    // 留着上一个仓库的面板定位会先闪一帧「上一个仓库的视图」再报错。
    // 两点必须注意（与 web-next 容器同口径）：
    //   ① 参数从 **window.location** 读，不用 searchParams —— 路由自身的 hydration 时序里它可能还没同步，
    //      读到 null 会把刚深链进来的 ?browse= 当场抹掉；
    //   ② 只在 repoId **真的变化**时清，首挂载不清 —— 否则深链/刷新同样保不住参数。
    if (previousRepoIdRef.current !== null && previousRepoIdRef.current !== repoId) {
      const live = new URLSearchParams(window.location.search);
      if (live.has('browse') || live.has('diff') || live.has('file') || live.has('snap')) {
        // 旧形态先规范化（把 snap/file 收成新的面板键），再统一把两个面板键删掉
        setSearchParams(withoutChangesPanel(withoutBrowsePanel(withMigratedSnapshot(live))), {
          replace: true,
          preventScrollReset: true,
        });
      }
    }
    previousRepoIdRef.current = repoId;
  }, [repoId]);
  /**
   * 旧深链改写（一次性）：`?snap=<hash>[&file=]` 是「面板开合用版本号的有无表达」时期的写法，
   * 现在读到就换成新形态（`browse[=<路径>]`，并以那个版本号补上选中提交）——
   * 旧书签/旧文档里的链接落在同一视图上。只做一次：改写后地址里不再有 snap，条件自然不再成立
   * （ref 防的是改写与路由同步之间的那一拍抖动）。
   */
  useEffect(() => {
    if (legacySnapRef.current || !isLegacySnapshotUrl(searchParams)) return;
    legacySnapRef.current = true;
    setSearchParams(withMigratedSnapshot(searchParams), { replace: true, preventScrollReset: true });
  }, [searchParams, setSearchParams]);
  // 状态未就绪前不渲染主体（加载态壳层后续任务再补）。
  // **必须放在上面这个 hook 之后**：本句是提前 return，若其上方还有 hook，首帧（status 未就绪）会少调一个 hook、
  // 次帧 status 到达后又补上 → React「Rendered more hooks than during the previous render」直接崩页
  // （web-koa 冷启动 `/repos/:id` 实测整页空白；web-next 同容器本就是 hook 在前、return 在后，此处对齐）。
  if (!status) return null;
  // 分支对比视图（?compare=<branch>）：双 range 查询就绪前不渲染（compareA/B 为 null key 条件拉取）
  if (compareBranch !== null) {
    if (compareA === undefined || compareB === undefined) return null;
    return (
      <BranchCompareView
        branch={compareBranch}
        branchCommits={compareA.commits}
        currentCommits={compareB.commits}
        onSelectCommit={(hash) => navigate(`/repos/${repoId}?select=${hash}`)}
        onExit={() => navigate(`/repos/${repoId}`)}
      />
    );
  }
  return (
    <>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载 LogPage——内嵌 Modal（创建分支/标签/Reword）与
          行右键菜单状态随之复位，不会跨仓库残留（§2.5 createOpen 硬化） */}
      <LogPage
        key={repoId}
        repoName={repos?.find((r) => r.id === repoId)?.name ?? repoId}
        status={status}
        commits={commits}
        onSelectCommit={onSelectCommit}
        selectedCommit={selectedCommit}
        operation={operation}
        // 中止失败以服务端中文 message 提示（成功响应已由 useAbortOperation 回写缓存）
        onAbortOperation={() => {
          abortOperation().catch((err: unknown) =>
            void message.error(err instanceof Error ? err.message : String(err)),
          );
        }}
        abortingOperation={abortingOperation}
        onUndoCommit={onUndoCommit}
        undoCommitting={undoCommitting}
        onResetHere={onResetHere}
        // 两个开关各自的回调（详情面板按钮）：都只切换**自己那一个** URL 参数，互不代劳
        onBrowse={() => onBrowse()}
        // 「浏览快照」开关开着时右栏出现文件树那一族标签（「文件（N）」+ 树里点开的文件标签）
        browseOpen={browseOn}
        // browseRev 只作标签栏的**重挂载键**（换版本即复位已打开的文件标签），不参与取数
        browseRev={selectedCommit?.shortHash ?? ''}
        browseEntries={browseTree?.entries}
        browseLoading={browseTreeLoading}
        browseError={browseTreeError?.message}
        {...(browseSelectedFile === undefined ? {} : { browseSelectedPath: browseSelectedFile })}
        browseContent={browseContent}
        browseContentLoading={browseSelectedFile !== undefined && browseContentLoading}
        browseContentError={browseContentError?.message}
        // 树里点文件（或标签栏要求改选中）：写 `browse=<路径>`；同路径再点 = 回**文件树**（聚合标签，写 `browse=`）
        onSelectBrowseFile={(file) => {
          if (!browseOn) return; // 文件树关着：这一族标签不存在，容器不该为它写参数
          const sameFile = browseSelectedFile === file;
          writePanels(sameFile ? PANEL_AGGREGATE : file, 'skip');
        }}
        onOpenChanges={() => onOpenChanges()}
        /* 变更集面板的开合真源是 `diff` 键在不在（URL）；hash 用 effectiveChangesHash 兜底
           （面板开着而选中项未落位时按当前选中的提交取数） */
        changesHash={changesOn ? effectiveChangesHash : ''}
        changesEntry={changesEntry}
        changesLoading={changesLoading}
        changesError={changesError?.message}
        // 开关的「开」态：变更集面板开着，且看的就是当前选中的这个提交
        changesActive={changesOn && effectiveChangesHash === selectedCommit?.hash}
        onCloseChanges={onCloseChanges}
        // 变更集清单里点文件：开成同一标签栏里的差异标签（已开则只切过去）——不再新开浏览器标签页。
        // 走 onChangesDiffChange 同一条路：切标签要写回地址栏（`?diff=<路径>`）
        onOpenChangedFile={(path) =>
          onChangesDiffChange({
            open: changesDiff.open.includes(path) ? changesDiff.open : [...changesDiff.open, path],
            active: path,
          })
        }
        changesDiff={changesDiff}
        onChangesDiffChange={onChangesDiffChange}
        changesDiffVersions={changesDiffVersions}
        // 未就绪与「在飞」同屏：变更集还没拉到、或差异还在路上，标签内都只表达「还没好」
        changesDiffLoading={changesDiff.active !== '' && (!changesEntryReady || changesDiffLoading)}
        changesDiffError={changesDiffError?.message}
        onOpenSettings={() => navigate(`/repos/${repoId}/settings`)}
        onGoHome={() => navigate('/')}
        onOpenLog={() => navigate(`/repos/${repoId}`)}
        onOpenStatus={() => navigate(`/repos/${repoId}/status`)}
        onOpenBranches={() => navigate(`/repos/${repoId}/branches`)}
        onOpenMerge={() => navigate(`/repos/${repoId}/merge`)}
        onOpenStashes={() => navigate(`/repos/${repoId}/stashes`)}
        onOpenConflicts={() => navigate(`/repos/${repoId}/conflicts`)}
        onOpenRebase={() => setRebaseOpen(true)}
        onOpenTags={() => navigate(`/repos/${repoId}/tags`)}
        onOpenBlame={() => navigate(`/repos/${repoId}/blame`)}
        onOpenHistory={() => navigate(`/repos/${repoId}/history`)}
        onOpenSearch={() => navigate(`/repos/${repoId}/search`)}
        onOpenPatches={() => navigate(`/repos/${repoId}/patches`)}
        onOpenShelves={() => navigate(`/repos/${repoId}/shelves`)}
        onOpenConsole={() => navigate(`/repos/${repoId}/console`)}
        onOpenIgnore={() => navigate(`/repos/${repoId}/ignore`)}
        onOpenGithub={() => navigate(`/repos/${repoId}/github`)}
        githubAvailable={githubStatus?.detected === true}
        onOpenGitlab={() => navigate(`/repos/${repoId}/gitlab`)}
        gitlabAvailable={gitlabStatus?.detected === true}
        onOpenWorktrees={() => navigate(`/repos/${repoId}/worktrees`)}
        onOpenSubmodules={() => navigate(`/repos/${repoId}/submodules`)}
        onCherryPick={onCherryPick}
        onRevert={onRevert}
        onAutosquash={onAutosquash}
        onEditCommit={onEditCommit}
        onPushUpToCommit={(hash) => {
          setPushUpToHash(hash);
          setOpenDialog('push');
        }}
        onOpenPull={() => setOpenDialog('pull')}
        onOpenPush={() => {
          setPushUpToHash(null);
          setOpenDialog('push');
        }}
        onOpenUpdate={() => setOpenDialog('update')}
        onOpenRemotes={() => navigate(`/repos/${repoId}/remotes`)}
        branchOptions={branchList?.branches.map((b) => b.name)}
        filters={{ author, path, branches: branchFilter }}
        onFiltersChange={(f) => {
          // 过滤变更：回到首屏窗口（分页复位到第一页），选定提交不在窗口时的降级由详情面板缺省逻辑承载
          setAuthor(f.author ?? '');
          setPath(f.path ?? '');
          setBranchFilter(f.branches ?? []);
          resetLogPages();
        }}
        initialLoading={logInitialLoading}
        hasMore={logHasMore}
        loadingMore={loadingMoreLog}
        onLoadMore={loadMoreLog}
        onCheckoutRevision={(hash) => {
          Modal.confirm({
            title: '检出此提交',
            content: '将切换到游离 HEAD 状态（建议先确认工作区干净），确定？',
            okText: '确定',
            cancelText: '取消',
            onOk: () =>
              checkout({ action: 'detach', ref: hash })
                .then(() => {
                  void message.success('已检出');
                  void mutateLog();
                })
                .catch(onError),
          });
        }}
        onCheckoutNewBranch={(hash, name) => {
          checkout({ action: 'newBranch', name, startPoint: hash })
            .then(() => void message.success(`已创建并检出分支 ${name}`))
            .catch(onError);
        }}
        onCreateTag={(hash, name, tagMessage) => {
          tagAction({ action: 'create', name, ref: hash, ...(tagMessage === undefined ? {} : { message: tagMessage }) })
            .then(() => void message.success(`已创建标签 ${name}`))
            .catch(onError);
        }}
        onOpenInBrowser={(hash) => {
          // 托管平台提交页链接：GitHub/GitLab 域检测（status 已挂载）；两者皆无 → 不渲染菜单项（回调不注入即隐藏）
          const gh = githubStatus?.repo;
          if (gh !== undefined) {
            window.open(`https://github.com/${gh.owner}/${gh.name}/commit/${hash}`, '_blank', 'noopener');
            return;
          }
          const gl = gitlabStatus?.repo;
          if (gl !== undefined) window.open(`https://gitlab.com/${gl.owner}/${gl.name}/-/commit/${hash}`, '_blank', 'noopener');
        }}
      />
      {/* 变基对话框：双模式状态机（简单 → useRebase；交互 → base 驱动 todo 重取 + useInteractiveRebase 提交）；
          取消即复位（RebaseDialog 内部状态自行复位，base 归空使 useRebaseTodo 挂 null key 停止重取） */}
      <RebaseDialog
        open={rebaseOpen}
        base={rebaseBase}
        todo={rebaseTodo}
        todoLoading={rebaseTodoLoading}
        todoError={rebaseTodoError?.message}
        confirming={rebasing || interactiveRebasing}
        onBaseChange={setRebaseBase}
        onRebaseOnto={onRebaseOnto}
        onInteractiveRebase={onInteractiveRebase}
        onCancel={() => {
          setRebaseBase('');
          setRebaseOpen(false);
        }}
      />
      <ResetDialog
        open={resetTarget !== null}
        ref={resetTarget?.hash ?? ''}
        refLabel={resetTarget?.label}
        confirming={resetting}
        onOk={onResetOk}
        onCancel={() => setResetTarget(null)}
      />
      {/* 远程列表未就绪时以空列表兜底（对话框内远程 Select 不预选，用户可待加载后重开） */}
      <PullDialog
        open={openDialog === 'pull'}
        remotes={remotes ?? { remotes: [], shallow: false }}
        confirming={pulling}
        onOk={onPullOk}
        onCancel={() => setOpenDialog(null)}
      />
      <PushDialog
        open={openDialog === 'push'}
        remotes={remotes ?? { remotes: [], shallow: false }}
        currentBranch={status.branch}
        confirming={pushing}
        upToHash={pushUpToHash ?? undefined}
        onOk={onPushOk}
        onCancel={() => {
          setPushUpToHash(null);
          setOpenDialog(null);
        }}
      />
      <UpdateProjectDialog
        open={openDialog === 'update'}
        confirming={updating}
        pushRejected={pendingPushRef.current !== null}
        outcome={updateOutcome}
        // Reset to tracked（GitUpdateOptionsDialog 左下，边 #93）：当前分支有上游才展示（Reset 默认关）
        resetToTracked={
          status.branch !== null && status.upstream !== null
            ? { localBranch: status.branch, upstream: status.upstream }
            : undefined
        }
        onResetToTracked={() => {
          if (status.branch === null || status.upstream === null) return;
          Modal.confirm({
            title: 'Reset 到上游分支？',
            content: `将丢弃 ${status.branch} 的工作区/暂存变更，硬重置到 ${status.upstream}；此操作不可恢复`,
            okText: '确定',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () =>
              resetTrigger({ ref: status.upstream!, mode: 'hard' })
                .then(() => {
                  void message.success(`已重置到 ${status.upstream}`);
                  setOpenDialog(null);
                  void mutate();
                })
                .catch(onError),
          });
        }}
        resetting={resetting}
        onOk={onUpdateOk}
        onCancel={() => {
          pendingPushRef.current = null;
          setUpdateOutcome(null);
          setOpenDialog(null);
        }}
      />
      {/* 认证重试回路出口：host 只读展示；取消即放弃原操作。confirming 覆盖保存与重试全程 */}
      <AuthDialog
        open={authRetry !== null}
        host={authRetry?.host ?? ''}
        confirming={savingAccount || pulling || pushing || updating}
        onOk={onAuthOk}
        onCancel={() => setAuthRetry(null)}
      />
    </>
  );
}
