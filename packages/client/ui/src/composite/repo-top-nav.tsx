/**
 * 仓库顶栏导航（从日志页顶栏抽出的共用组件）：**面包屑「首页 / 仓库名 / 当前页名」三级** + 图标按钮组 + 「更多」下拉，
 * 除欢迎屏外的所有仓库页共用——每页经 `current` 指明自身，对应图标按钮高亮（color=primary + variant=filled，主色浅底填充），
 * 面包屑末级落到当前页名（非日志页的仓库名可点回日志页）。
 * 纯 props 驱动（沿用 ui 层约定：回调不注入即隐藏，不出现点了没反应的死控件）。
 * 日志页专属内容（操作条/撤销最近提交/「去解决冲突」链接）为可选 props：仅日志页容器注入；
 * 状态条（分支名胶囊 + ahead/behind 圆点）经两端 useRepoNav 的 status 装配在**所有仓库页**显示，
 * 位置在**右侧操作区最左**（用户口径）：左区归导航信息（面包屑），右区是「当前分支 + 操作入口」一整组，
 * 分支名于是紧挨着分支/合并等操作按钮；左区因此只剩进行中操作条与「去解决冲突」链接。
 * 拉取/推送/更新项目/变基四个「更多」菜单项是日志页容器持有的对话框入口——同样走可选注入，其余页面不注入即不出现。
 * 「日志」按钮（HistoryOutlined）是本组件新增的回日志页入口：替换掉各页原先的「返回日志」链接后，
 * 从任何仓库页都能一键回日志页，也让日志页自身有可高亮的图标。
 */
import { BranchesOutlined, DiffOutlined, HistoryOutlined, InboxOutlined, MergeOutlined, MoreOutlined, RollbackOutlined, SettingOutlined } from '@ant-design/icons';
import { Breadcrumb, Button, Col, Dropdown, Popconfirm, Row, Space, Tooltip, Typography, theme } from 'antd';
import type { OperationState, RepoStatus } from '@rebased/contracts';
import { useState } from 'react';
import { OperationStatus } from '../base/operation-status';
import { RepoStatusBar } from '../domain/repo-status-bar';

/**
 * 仓库页标识：`current` 传当前页，对应图标按钮高亮。
 * 前六个（log/status/branches/merge/stashes/settings）各有专属按钮；
 * 其余（blame…submodules）都在「更多」菜单里——落在这些页时高亮「更多」按钮本身；
 * conflicts/diff 不在导航任何位置，落在它们上时不高亮任何按钮。
 */
export type RepoNavPage =
  | 'log'
  | 'status'
  | 'branches'
  | 'merge'
  | 'stashes'
  | 'settings'
  | 'blame'
  | 'history'
  | 'search'
  | 'tags'
  | 'remotes'
  | 'patches'
  | 'shelves'
  | 'console'
  | 'ignore'
  | 'github'
  | 'gitlab'
  | 'worktrees'
  | 'submodules'
  | 'conflicts'
  | 'diff';

/** 「更多」菜单承载的页面：落在这些页时高亮「更多」按钮（conflicts/diff 不在菜单内，无高亮） */
const MORE_MENU_PAGES: ReadonlySet<RepoNavPage> = new Set([
  'blame',
  'history',
  'search',
  'tags',
  'remotes',
  'patches',
  'shelves',
  'console',
  'ignore',
  'github',
  'gitlab',
  'worktrees',
  'submodules',
]);

/**
 * 当前页名（面包屑末级文案）：与「更多」菜单项及 manual 各页小节标题同源；
 * diff 不经本组件渲染（页面未接入导航，保留映射完备性仅为 Record 全量约束）。
 */
const PAGE_NAMES: Record<RepoNavPage, string> = {
  log: '提交',
  status: '变更',
  branches: '分支',
  merge: '合并',
  stashes: '贮藏',
  settings: '设置',
  blame: '溯源',
  history: '历史',
  search: '搜索',
  tags: '标签',
  remotes: '远程管理',
  patches: '补丁',
  shelves: '搁置',
  console: '控制台',
  ignore: '忽略',
  github: 'GitHub 面板',
  gitlab: 'GitLab 面板',
  worktrees: '工作树',
  submodules: '子模块',
  conflicts: '冲突',
  diff: '差异',
};

export interface RepoTopNavProps {
  /** 仓库名（面包屑末级，展示用） */
  repoName: string;
  /** 当前页标识：对应图标按钮高亮（详见 {@link RepoNavPage}） */
  current?: RepoNavPage;
  /** 回首页（欢迎屏）回调（File→Close Project 语义）；缺省不渲染「首页」链接 */
  onGoHome?: () => void;
  /** 日志页入口回调（本组件新增的回日志页按钮）；缺省不渲染该按钮 */
  onOpenLog?: () => void;
  /** 变更（状态页）入口回调；缺省不渲染变更按钮 */
  onOpenStatus?: () => void;
  /** 分支页入口回调；缺省不渲染分支按钮 */
  onOpenBranches?: () => void;
  /** 合并页入口回调；缺省不渲染合并按钮 */
  onOpenMerge?: () => void;
  /** 贮藏页入口回调；缺省不渲染贮藏按钮 */
  onOpenStashes?: () => void;
  /** 设置页入口回调；缺省不渲染设置按钮 */
  onOpenSettings?: () => void;
  /** 溯源页入口回调；缺省时「更多」菜单不含溯源项 */
  onOpenBlame?: () => void;
  /** 文件历史页入口回调；缺省时「更多」菜单不含历史项 */
  onOpenHistory?: () => void;
  /** 提交搜索页入口回调；缺省时「更多」菜单不含搜索项 */
  onOpenSearch?: () => void;
  /** 拉取对话框入口回调（日志页容器持有对话框）；缺省时「更多」菜单不含拉取项 */
  onOpenPull?: () => void;
  /** 推送对话框入口回调（日志页容器持有对话框）；缺省时「更多」菜单不含推送项 */
  onOpenPush?: () => void;
  /** 更新项目对话框入口回调（日志页容器持有对话框）；缺省时「更多」菜单不含更新项目项 */
  onOpenUpdate?: () => void;
  /** 远程管理页入口回调；缺省时「更多」菜单不含远程管理项 */
  onOpenRemotes?: () => void;
  /** 变基对话框入口回调（日志页容器持有对话框）；缺省时「更多」菜单不含变基项 */
  onOpenRebase?: () => void;
  /** 标签页入口回调；缺省时「更多」菜单不含标签项 */
  onOpenTags?: () => void;
  /** 冲突页入口回调；仅当日志页合并进行中时渲染「去解决冲突」链接，缺省不渲染 */
  onOpenConflicts?: () => void;
  /** 补丁页入口回调；缺省时「更多」菜单不含补丁项 */
  onOpenPatches?: () => void;
  /** 搁置页入口回调；缺省时「更多」菜单不含搁置项 */
  onOpenShelves?: () => void;
  /** 控制台页入口回调；缺省时「更多」菜单不含控制台项 */
  onOpenConsole?: () => void;
  /** 忽略配置页入口回调；缺省时「更多」菜单不含忽略项 */
  onOpenIgnore?: () => void;
  /** GitHub 面板页入口回调；与 githubAvailable 同传（均为有效值）时「更多」菜单才含 GitHub 面板项 */
  onOpenGithub?: () => void;
  /** GitHub 面板可用性（容器经 useGithubStatus 检测到 GitHub 远程）：false/缺省不渲染 GitHub 面板菜单项 */
  githubAvailable?: boolean;
  /** GitLab 面板页入口回调；与 gitlabAvailable 同传（均为有效值）时「更多」菜单才含 GitLab 面板项 */
  onOpenGitlab?: () => void;
  /** GitLab 面板可用性（容器经 useGitlabStatus 检测到 GitLab 远程）：false/缺省不渲染 GitLab 面板菜单项 */
  gitlabAvailable?: boolean;
  /** 工作树页入口回调；恒渲染（无可用性门——工作树是任何仓库都可达的操作面），缺省时「更多」菜单不含工作树项 */
  onOpenWorktrees?: () => void;
  /** 子模块页入口回调；恒渲染（无可用性门——子模块空态在页面内承载），缺省时「更多」菜单不含子模块项 */
  onOpenSubmodules?: () => void;
  /** 撤销最近提交回调（Popconfirm 确认后触发，日志页专属）；缺省不渲染撤销按钮 */
  onUndoCommit?: () => void;
  /** 撤销请求进行中：撤销按钮 loading 态 */
  undoCommitting?: boolean;
  /** 仓库状态（驱动 RepoStatusBar：分支名胶囊 + ahead/behind 圆点）；两端容器经 useRepoNav 装配——所有仓库页显示，缺省不渲染状态条 */
  status?: RepoStatus;
  /** 进行中操作状态（日志页专属）；与 onAbortOperation 同传时渲染操作条 */
  operation?: OperationState;
  /** 中止当前操作回调（经 OperationStatus 的 Popconfirm 确认后触发） */
  onAbortOperation?: () => void;
  /** 中止请求进行中：操作条按钮 loading 态 */
  abortingOperation?: boolean;
}

export function RepoTopNav({
  repoName,
  current,
  onGoHome,
  onOpenLog,
  onOpenStatus,
  onOpenBranches,
  onOpenMerge,
  onOpenStashes,
  onOpenSettings,
  onOpenBlame,
  onOpenHistory,
  onOpenSearch,
  onOpenPull,
  onOpenPush,
  onOpenUpdate,
  onOpenRemotes,
  onOpenRebase,
  onOpenTags,
  onOpenConflicts,
  onOpenPatches,
  onOpenShelves,
  onOpenConsole,
  onOpenIgnore,
  onOpenGithub,
  githubAvailable,
  onOpenGitlab,
  gitlabAvailable,
  onOpenWorktrees,
  onOpenSubmodules,
  onUndoCommit,
  undoCommitting,
  status,
  operation,
  onAbortOperation,
  abortingOperation,
}: RepoTopNavProps): React.ReactNode {
  // 顶栏分隔线走主题 token（原 #f0f0f0 硬编码在暗色主题下过亮）
  const { token } = theme.useToken();
  /**
   * 「更多」菜单是否展开：展开期间抑制触发按钮的气泡。
   * 原因（浏览器实测）：按钮在页面顶部，气泡会被 antd 翻到下方，正好压住菜单顶部若干项——
   * elementFromPoint 命中的是气泡容器，菜单项既出不了高亮也出不了自己的气泡。
   */
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // 高亮判定：主按钮区按 current 精确命中；「更多」菜单页命中「更多」按钮；conflicts/diff 不高亮
  const isCurrent = (page: Exclude<RepoNavPage, 'conflicts' | 'diff'>): boolean => current === page;
  const moreActive = current !== undefined && MORE_MENU_PAGES.has(current);
  /**
   * 导航图标按钮的统一渲染：非激活态保持既有 type="text"（与抽取前逐像素一致）；
   * 激活态换 color="primary" + variant="filled"（主色浅底填充，antd 原生配色对——
   * 不传 type，color/variant 优先生效；light/dark 主题各自适配，无手写样式）。
   */
  const navIcon = (label: string, tooltip: string, icon: React.ReactNode, onClick: (() => void) | undefined, active: boolean): React.ReactNode =>
    onClick === undefined ? null : (
      <Tooltip title={tooltip}>
        <Button
          aria-label={label}
          type={active ? undefined : 'text'}
          color={active ? 'primary' : undefined}
          variant={active ? 'filled' : undefined}
          size="small"
          icon={icon}
          onClick={onClick}
        />
      </Tooltip>
    );
  /** 「更多」菜单项：仅装配容器注入回调的入口（页面导航 + 日志页对话框项）；全缺省时连「更多」按钮都不渲染 */
  const moreItems = [
    ...(onOpenBlame ? [{ key: 'blame', label: <Tooltip title="打开逐行溯源视图：查看每一行的最后修改者与提交"><span>溯源</span></Tooltip> }] : []),
    ...(onOpenHistory ? [{ key: 'history', label: <Tooltip title="打开该文件的提交历史：只看改动过它的记录"><span>历史</span></Tooltip> }] : []),
    ...(onOpenSearch ? [{ key: 'search', label: <Tooltip title="在整个仓库历史中按提交信息、作者或文件内容检索"><span>搜索</span></Tooltip> }] : []),
    ...(onOpenRebase ? [{ key: 'rebase', label: <Tooltip title="打开变基对话框：把当前分支的提交重新应用到指定基底（会重写提交哈希）"><span>变基</span></Tooltip> }] : []),
    ...(onOpenTags ? [{ key: 'tags', label: <Tooltip title="打开标签管理页：查看、创建或删除仓库标签"><span>标签</span></Tooltip> }] : []),
    ...(onOpenPull ? [{ key: 'pull', label: <Tooltip title="从远程拉取最新提交并合入当前分支"><span>拉取</span></Tooltip> }] : []),
    ...(onOpenPush ? [{ key: 'push', label: <Tooltip title="把当前分支的本地提交推送到远程跟踪分支"><span>推送</span></Tooltip> }] : []),
    ...(onOpenUpdate ? [{ key: 'update', label: <Tooltip title="按配置的同步策略从远程更新当前分支（合并或变基）"><span>更新项目</span></Tooltip> }] : []),
    ...(onOpenRemotes ? [{ key: 'remotes', label: <Tooltip title="管理远程仓库：查看、新增、编辑或删除远程地址"><span>远程管理</span></Tooltip> }] : []),
    ...(onOpenPatches ? [{ key: 'patches', label: <Tooltip title="补丁工具：把改动导出为补丁文件，或把补丁应用到工作区"><span>补丁</span></Tooltip> }] : []),
    ...(onOpenShelves ? [{ key: 'shelves', label: <Tooltip title="搁置区：临时存放未完成的改动，之后可取出恢复"><span>搁置</span></Tooltip> }] : []),
    ...(onOpenConsole ? [{ key: 'console', label: <Tooltip title="打开 Git 控制台：在当前仓库直接执行 git 命令并查看输出"><span>控制台</span></Tooltip> }] : []),
    ...(onOpenIgnore ? [{ key: 'ignore', label: <Tooltip title="编辑忽略规则：把选中的文件或目录加入 .gitignore，之后不再视为未跟踪变更"><span>忽略</span></Tooltip> }] : []),
    // GitHub 面板：仅在容器检测到 GitHub 远程（githubAvailable）且注入导航回调时渲染（对齐 Java 检测到远程才显示工具窗口）
    ...(onOpenGithub !== undefined && githubAvailable ? [{ key: 'github', label: <Tooltip title="打开 GitHub 面板：查看该仓库关联的 PR、议题与动态"><span>GitHub 面板</span></Tooltip> }] : []),
    // GitLab 面板：与 GitHub 面板项并排、各自检测（容器经 useGitlabStatus 判定 gitlabAvailable）
    ...(onOpenGitlab !== undefined && gitlabAvailable ? [{ key: 'gitlab', label: <Tooltip title="打开 GitLab 面板：查看该仓库关联的 MR、议题与动态"><span>GitLab 面板</span></Tooltip> }] : []),
    // 工作树/子模块：恒渲染（无可用性门——本域无外部依赖，任何仓库可达；子模块空态在页面内承载）
    ...(onOpenWorktrees ? [{ key: 'worktrees', label: <Tooltip title="管理工作树：查看并新增或删除同一仓库的多个检出目录"><span>工作树</span></Tooltip> }] : []),
    ...(onOpenSubmodules ? [{ key: 'submodules', label: <Tooltip title="管理子模块：查看状态、初始化或更新嵌套仓库"><span>子模块</span></Tooltip> }] : []),
  ];
  /** 「更多」菜单点击分发：按 key 调对应入口回调 */
  const onMoreClick = (key: string): void => {
    if (key === 'blame') onOpenBlame?.();
    else if (key === 'history') onOpenHistory?.();
    else if (key === 'search') onOpenSearch?.();
    else if (key === 'rebase') onOpenRebase?.();
    else if (key === 'tags') onOpenTags?.();
    else if (key === 'pull') onOpenPull?.();
    else if (key === 'push') onOpenPush?.();
    else if (key === 'update') onOpenUpdate?.();
    else if (key === 'remotes') onOpenRemotes?.();
    else if (key === 'patches') onOpenPatches?.();
    else if (key === 'shelves') onOpenShelves?.();
    else if (key === 'console') onOpenConsole?.();
    else if (key === 'ignore') onOpenIgnore?.();
    else if (key === 'github') onOpenGithub?.();
    else if (key === 'gitlab') onOpenGitlab?.();
    else if (key === 'worktrees') onOpenWorktrees?.();
    else if (key === 'submodules') onOpenSubmodules?.();
  };
  /** 仓库名是否作为「回日志页」链接：非日志页且注入了 onOpenLog（日志页自己是末级，点了也是原地） */
  const repoNameClickable = current !== undefined && current !== 'log' && onOpenLog !== undefined;
  /**
   * 面包屑 items：三级「首页（可点回欢迎屏，仅注入 onGoHome 时）/ 仓库名 / 当前页名（加粗末级）」。
   * 仓库名的渲染分三态（面包屑中间级的惯例——非末级可点，指向它代表的页面）：
   *   · 非日志页且注入 onOpenLog：Typography.Link 回日志页（它渲染 <a>，吃到 breadcrumb 的链接色与 hover 底色）；
   *   · 日志页：纯文本——末级让位给「提交」，仓库名退为中间级；
   *   · current 缺省的兜底形态：加粗文本——保持抽取前的原两级样式，既有调用方不受影响。
   * 当前页名仅 current 传入时追加（与「更多」菜单文案同源，见 PAGE_NAMES）。
   */
  const breadcrumbItems = [
    ...(onGoHome
      ? [
        {
          title: (
            <Tooltip title="回到首页欢迎屏：关闭当前仓库视图，不改动仓库里的任何内容">
              {/* Typography.Link 渲染为 <a>：breadcrumb 的链接样式挂在 `-item a` 上，用 Button link 会拿不到 */}
              <Typography.Link
                data-testid="log-go-home"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onGoHome();
                }}
              >
                首页
              </Typography.Link>
            </Tooltip>
          ),
        },
      ]
      : []),
    {
      title: repoNameClickable ? (
        <Tooltip title="回到该仓库的提交日志页">
          <Typography.Link
            data-testid="log-repo-link"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onOpenLog();
            }}
          >
            {repoName}
          </Typography.Link>
        </Tooltip>
      ) : current === undefined ? (
        <Typography.Text strong>{repoName}</Typography.Text>
      ) : (
        <Typography.Text>{repoName}</Typography.Text>
      ),
    },
    ...(current !== undefined ? [{ title: <Typography.Text strong>{PAGE_NAMES[current]}</Typography.Text> }] : []),
  ];
  /**
   * 左区两块可选内容（分支状态条已按用户口径移到右侧操作区最左）：先把两块算成节点，再按「节点是否为空」决定整块 Space 渲染与否。
   * 为什么不另写一份条件：两块各有自己的渲染门，另写必错位——实测踩过两次：
   *   · OperationStatus 在 kind==='none' 时自己渲染 null，而容器无进行中操作时传下来的正是 `{kind:'none'}`，
   *     只按 `!== undefined` 判空会在左区留一个空的 ant-space（空 ant-space-item）；
   *   · 「去解决冲突」只依赖 onOpenConflicts（merge 进行中且容器注入导航时即出，不需要中止回调），
   *     把 infoExtras 绑在 operation+onAbortOperation 上会把这一块整个吞掉。
   */
  const operationBar =
    operation !== undefined && operation.kind !== 'none' && onAbortOperation !== undefined ? (
      <OperationStatus operation={operation} onAbort={onAbortOperation} aborting={abortingOperation} />
    ) : null;
  const conflictsLink =
    operation?.kind === 'merge' && onOpenConflicts !== undefined ? (
      <Tooltip title="打开冲突解决页：逐个文件处理合并冲突，解决完再提交以结束合并">
        <Button type="link" size="small" onClick={onOpenConflicts}>
          去解决冲突
        </Button>
      </Tooltip>
    ) : null;
  const infoExtras = operationBar !== null || conflictsLink !== null;
  return (
    /* 顶栏两端布局：Grid（Row/Col）负责「左信息区 ←→ 右操作区」两端分布，Space 负责两侧组内间距。
       为什么不再用 `marginLeft:auto` 逐个占位：那是「凑」出右端，可选按钮一多，每个按钮都要按
       「前面还有哪个按钮会渲染」重算一遍条件；改成两端容器后左右各自成组，右端位置与按钮渲染条件彻底解耦。
       注意两点：
       1) Row/Col 从 'antd' 顶层具名导入；`Grid` 这个具名导出在 antd 6.6.3 运行时只有 useBreakpoint
          （`es/grid/index.js` 只 default 出 { useBreakpoint }，Col/Row 是**具名**导出），在它上面解构 Row/Col 会拿到 undefined。
       2) Row 默认 flexWrap='wrap'，且 Col 默认 `flex: 0 0 auto`（不收缩）——左侧必须显式给
          flex:'1 1 auto' + minWidth:0 才能被压缩（否则撑开 Row 把操作区挤到第二行）。 */
    <Row
      data-testid="log-topbar"
      align="middle"
      justify="space-between"
      style={{ borderBottom: `1px solid ${token.colorSplit}`, padding: '4px 8px' }}
    >
      {/* 左侧信息区：**面包屑**（首页 / 仓库名 / 当前页名）+ 进行中操作条；整体可收缩（窄屏优先压缩这一侧） */}
      <Col style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', minWidth: 0 }}>
        {/* 面包屑三级形态（items 装配见上方 breadcrumbItems）；
            外层 `overflow: hidden` 保证超长仓库名/状态条不会把右端操作区挤出顶栏（承接原「minWidth:0 让长名可压缩」的口径） */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
          <Breadcrumb data-testid="log-breadcrumb" items={breadcrumbItems} />
          {infoExtras ? (
            <Space size={16} style={{ minWidth: 0 }}>
              {/* 进行中操作条与「去解决冲突」链接（两块节点在上方按各自的门算好，见 operationBar/conflictsLink） */}
              {operationBar}
              {conflictsLink}
            </Space>
          ) : null}
        </div>
      </Col>
      {/* 右侧操作区：**最左是分支状态条**（当前分支 + ahead/behind 圆点），其后是撤销/日志/变更/分支/合并/贮藏/设置/更多 八个入口，
          整组靠 justify="space-between" 贴右端 */}
      <Col style={{ flexShrink: 0 }}>
        <Space size={4} data-testid="log-actions">
          {/* 分支状态条（用户口径：与操作按钮同组、占该组最左）：全分支名可能很长，
              而右区不收缩，故 chip 自带 maxWidth + 省略号（见 domain/repo-status-bar）；
              额外 4px 右外边距让它与第一个按钮之间的实际间距是 8px（Space 自身 4px + 这里 4px） */}
          {status !== undefined ? (
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, marginInlineEnd: 4 }}>
              <RepoStatusBar status={status} />
            </div>
          ) : null}
          {/* 撤销最近提交（日志页专属）：Popconfirm 确认后回调（保留改动到暂存区，等价 reset --soft HEAD~1） */}
          {onUndoCommit ? (
            <Popconfirm
              title="将撤销最近提交并保留改动到暂存区"
              okText="确定"
              cancelText="取消"
              onConfirm={onUndoCommit}
            >
              {/* Tooltip 必须放在 Popconfirm 内侧：放外侧会截断 Popconfirm 的点击触发链，确认气泡就不再出现 */}
              <Tooltip title="回退最近一次提交并保留全部改动到暂存区（等价 reset --soft HEAD~1），提交记录会少一笔">
                <Button
                  aria-label="撤销最近提交"
                  type="text"
                  size="small"
                  icon={<RollbackOutlined />}
                  loading={undoCommitting}
                />
              </Tooltip>
            </Popconfirm>
          ) : null}
          {/* 日志入口（本组件新增）：任何仓库页一键回提交日志页；当前就在日志页时高亮 */}
          {navIcon('日志', '打开该仓库的提交日志页：图形化查看全部提交历史', <HistoryOutlined />, onOpenLog, isCurrent('log'))}
          {/* 变更入口（状态页） */}
          {navIcon('变更', '打开变更页：查看工作区与暂存区的文件改动，逐个文件对照差异', <DiffOutlined />, onOpenStatus, isCurrent('status'))}
          {/* 分支入口 */}
          {navIcon('分支', '打开分支页：查看本地/远程分支并执行新建、检出、合并等操作', <BranchesOutlined />, onOpenBranches, isCurrent('branches'))}
          {/* 合并入口 */}
          {navIcon('合并', '打开合并页：把选定的分支或提交并入当前分支', <MergeOutlined />, onOpenMerge, isCurrent('merge'))}
          {/* 贮藏入口 */}
          {navIcon('贮藏', '打开贮藏页：把未提交的改动暂存起来，或把已有贮藏重新应用回工作区', <InboxOutlined />, onOpenStashes, isCurrent('stashes'))}
          {/* 设置入口 */}
          {navIcon('设置', '打开仓库设置：该仓库的 git 配置（local）与 GPG 提交签名（应用级项在首页「设置」）', <SettingOutlined />, onOpenSettings, isCurrent('settings'))}
          {/* 「更多」Dropdown：只读浏览与远程相关操作及 P3-D 四入口的收敛入口，跟在设置按钮之后 */}
          {moreItems.length > 0 ? (
            <Dropdown
              trigger={['click']}
              onOpenChange={setMoreMenuOpen}
              menu={{ items: moreItems, onClick: ({ key }) => onMoreClick(key) }}
            >
              {/* Tooltip 放在 Dropdown 内侧：Dropdown 需要直接包裹真实控件才能接住点击触发 */}
              <Tooltip
                title="更多功能：只读浏览（溯源/历史/搜索）、本地操作与远程操作统一收在这里"
                open={moreMenuOpen ? false : undefined}
              >
                <Button
                  aria-label="更多"
                  type={moreActive ? undefined : 'text'}
                  color={moreActive ? 'primary' : undefined}
                  variant={moreActive ? 'filled' : undefined}
                  size="small"
                  icon={<MoreOutlined />}
                />
              </Tooltip>
            </Dropdown>
          ) : null}
        </Space>
      </Col>
    </Row>
  );
}
