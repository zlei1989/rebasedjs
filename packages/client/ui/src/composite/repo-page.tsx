/**
 * 仓库首页：最近仓库列表 + 打开/克隆/初始化入口。
 * UX 对齐 #3（spec §6.3）：显示名来自注册 name（服务端注册时解析——单级目录名定案，
 * `.idea/.name` 依 spec §2.2 无对应概念，见盘点报告 §4.1）、
 * 路径副文本 user-home 相对化（`~/…`，homeDir 由容器注入）、移除带 Popconfirm 确认、
 * 最近优先/去重/上限 50（服务端与组件同口径）。
 * 克隆/初始化 Modal 对齐 VcsCloneDialog 最小字段集（URL + Directory / 路径表单）。
 * 最近仓库列表走 antd Listy（6.6.0 起的列表组件）：行不挂 Tooltip，行内容由调用方渲染。
 * 纯 props 驱动：ui 不调接口，repos/onOpen/onOpenRepo/onRemove/onClone/onInit/homeDir 由调用方容器注入 hooks 数据。
 * 点击最近列表项打开该仓库（注入 onOpenRepo 才可点）+ 打开中行内加载态（openingRepoId 命中行）。
 * 列表项呈现（RecentProjectPanel 的 RecentProjectItemRenderer 等价）：首字母渐变头像 + 「名称  [分支]」+
 * 失效标记（路径不存在时整行弱化、点击只弹确认而不打开）。
 */
import { useMemo, useState } from 'react';
import { Button, Flex, Input, Listy, Modal, Popconfirm, Spin, theme, Tooltip, Typography } from 'antd';
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, SettingOutlined, SwitcherOutlined, WarningOutlined } from '@ant-design/icons';
import type { RecentRepoInfo, RepoInfo } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { PageShell } from '../base/page-shell';
import { Toolbar } from '../base/toolbar';
import { RepoAvatar } from './repo-avatar';
import { relativeToHome } from './repo-page-utils';

/**
 * 列表项：服务端派生的 branch/valid/colorIndex 可缺省——ui 组件测试与只给 RepoInfo 的调用方按
 * 「无分支后缀、路径可用、色号 0（第一组渐变）」渲染（缺省即不显示后缀、不标记失效，无死分支）。
 */
export type RepoListItem = RepoInfo & Partial<Omit<RecentRepoInfo, keyof RepoInfo>>;

/** 失效后缀（IdeBundle.properties:2632 `recent.project.unavailable`） */
const UNAVAILABLE_SUFFIX = '(unavailable)';

export interface RepoPageProps {
  repos: RepoListItem[];
  /** 打开表单提交（path 为用户输入的仓库路径） */
  onOpen: (path: string) => void;
  /**
   * 点击最近列表项打开该仓库（Java 侧入口为 `OpenSelectedProjectsAction`，此处用单击）；
   * 缺省不启用点击（无死控件约定）。
   * 传整个 RepoInfo 而非 id：容器需 path 走打开流程（校验 + 注册 + 刷新「最近」排序）。
   */
  onOpenRepo?: (repo: RepoInfo) => void;
  /** 正在打开的仓库 id：该行显示加载态、忽略再次点击并禁用「移除」（打开含 POST 往返 + 配置落盘 + 列表刷新，有耗时） */
  openingRepoId?: string;
  /**
   * 移除确认后回调（repoId）。按钮仅在 onRemove 提供时出现，未提供时不渲染（避免死控件）。
   */
  onRemove?: (repoId: string) => void;
  /** 用户主目录：浏览器端无法读 os.homedir()，由容器注入用于路径副文本相对化 */
  homeDir?: string;
  /** 克隆回调（url, targetDir）；缺省不渲染克隆入口 */
  onClone?: (url: string, targetDir: string) => void;
  /** 初始化回调（path）；缺省不渲染初始化入口 */
  onInit?: (path: string) => void;
  /** 克隆进行中：Modal 确定按钮 loading */
  cloning?: boolean;
  /** 初始化进行中：Modal 确定按钮 loading */
  initializing?: boolean;
  /** 设置入口（欢迎屏 Configure 语义）：打开**应用设置**页（与仓库无关，故无仓库时也可点）；缺省不渲染 */
  onOpenSettings?: () => void;
}

/** 最近列表上限（对齐 Java RecentProjectsManagerBase 上限 50，与服务端 RECENT_LIMIT 同口径） */
const MAX_RECENT = 50;

/** 克隆对话框（对照 VcsCloneDialog 最小字段集）：URL + 落盘目录，双必填 */
function CloneModal({
  open,
  acting,
  onClone,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onClone: (url: string, targetDir: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const [url, setUrl] = useState('');
  const [dir, setDir] = useState('');
  /** 关闭时复位输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setUrl('');
    setDir('');
    onClose();
  };
  /** 提交并关闭（异步结果由容器反馈；失败可重开重试） */
  const submit = (): void => {
    if (url.trim() === '' || dir.trim() === '') return;
    onClone(url.trim(), dir.trim());
    close();
  };
  return (
    <Modal
      title="克隆仓库"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: url.trim() === '' || dir.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Tooltip title="仓库 URL：https / ssh 均可，也可填本地路径">
          <Input
            data-testid="clone-url"
            placeholder="仓库 URL（https/ssh/本地路径）"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="克隆落盘目录：父目录须已存在（git clone 语义）">
          <Input
            data-testid="clone-dir"
            placeholder="目标目录（父目录须存在，git clone 语义）"
            value={dir}
            onChange={(e) => setDir(e.target.value)}
          />
        </Tooltip>
      </Flex>
    </Modal>
  );
}

/** 初始化仓库对话框：路径必填（git init 目标目录，不存在时创建） */
function InitModal({
  open,
  acting,
  onInit,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onInit: (path: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const [path, setPath] = useState('');
  const close = (): void => {
    setPath('');
    onClose();
  };
  const submit = (): void => {
    const trimmed = path.trim();
    if (trimmed === '') return;
    onInit(trimmed);
    close();
  };
  return (
    <Modal
      title="初始化仓库"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: path.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Tooltip title="新建仓库目录：不存在时创建（git init 目标）">
          <Input
            data-testid="init-path"
            placeholder="仓库目录（不存在时创建）"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </Tooltip>
      </Flex>
    </Modal>
  );
}

export function RepoPage({
  repos,
  onOpen,
  onOpenRepo,
  openingRepoId,
  onRemove,
  homeDir = '',
  onClone,
  onInit,
  cloning,
  initializing,
  onOpenSettings,
}: RepoPageProps): React.ReactNode {
  // 分隔线与副文本走主题 token（原 #f0f0f0/#888 是明亮专用硬编码，暗色主题下过亮）
  const { token } = theme.useToken();
  const [openPath, setOpenPath] = useState('');
  const [cloneOpen, setCloneOpen] = useState(false);
  const [initOpen, setInitOpen] = useState(false);
  // 失效仓库的确认对话框目标（null = 关闭）：对齐 ReopenProjectAction.showReopenDialog——
  // 路径不存在的项不直接走打开流程，先让用户确认
  const [invalidRepo, setInvalidRepo] = useState<RepoListItem | null>(null);
  // 最近优先（openedAt 降序）→ 同路径去重（保留最近一条）→ 截断上限 50
  const visible = useMemo(() => {
    const sorted = [...repos].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const seen = new Set<string>();
    const out: RepoListItem[] = [];
    for (const repo of sorted) {
      if (seen.has(repo.path)) continue;
      seen.add(repo.path);
      out.push(repo);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }, [repos]);

  const submitOpen = (): void => {
    const path = openPath.trim();
    if (path) onOpen(path);
  };

  // 页面根：PageShell 自带纵向 Flex + width:100% + minWidth:0 + height:100%（并施加紧凑密度）。
  // 原 maxWidth:720 会人为收窄页面（不满足横向沾满）故移除；gap/padding 照抄既有值。
  return (
    <PageShell gap={16} padding={16}>
      <Toolbar gap={8}>
        <Tooltip title="仓库路径：支持 ~ 前缀，回车等同点「打开」">
          <Input
            placeholder="仓库路径"
            size="small"
            value={openPath}
            onChange={(e) => setOpenPath(e.target.value)}
            onPressEnter={submitOpen}
            style={{ minWidth: 200, flex: 1 }}
          />
        </Tooltip>
        <Tooltip title="打开该路径：校验并注册为最近仓库，随后进入提交日志页">
          <Button type="primary" size="small" icon={<FolderOpenOutlined />} onClick={submitOpen}>
            打开
          </Button>
        </Tooltip>
        {/* 克隆/初始化：入口按钮仅在容器注入回调时渲染（端点未接线时不出现死控件） */}
        {onClone ? (
          <Tooltip title="从远程 URL 克隆一个新仓库到本地目录">
            <Button icon={<SwitcherOutlined />} size="small" loading={cloning} onClick={() => setCloneOpen(true)}>
              克隆
            </Button>
          </Tooltip>
        ) : null}
        {onInit ? (
          <Tooltip title="在指定目录新建（git init）一个空仓库">
            <Button icon={<PlusOutlined />} size="small" loading={initializing} onClick={() => setInitOpen(true)}>
              初始化
            </Button>
          </Tooltip>
        ) : null}
        {/* 设置入口（欢迎屏 Configure 语义）：应用设置是全局项（外观/保护分支/账户），与是否有最近仓库无关 */}
        {onOpenSettings ? (
          <Tooltip title="打开应用设置：界面主题、保护分支模式、Git 可执行文件与账户（对所有仓库生效）">
            <Button
              icon={<SettingOutlined />}
              size="small"
              data-testid="open-settings-button"
              onClick={() => onOpenSettings()}
            >
              设置
            </Button>
          </Tooltip>
        ) : null}
      </Toolbar>
      {visible.length === 0 ? (
        <EmptyState title="暂无最近仓库" description="输入路径打开一个 Git 仓库" />
      ) : (
        // 最近仓库列表走 antd Listy（6.6.0 起的列表组件，取代老 List）：容器/行结构/悬停底色由组件负责，
        // 调用方只给数据与行内容，不再手写 flex 行 + borderBottom + 悬停状态。
        // 行**不挂 Tooltip**（产品口径：行级气泡与「移除」按钮气泡会在同一块悬停区叠弹，且行的可点后果已由文案与按钮自述）。
        // Listy 的行底色悬停由组件 `:hover` 承担（controlItemBgHover），故原本驱动悬停的 hoverId 状态一并删掉。
        <Listy
          items={visible}
          rowKey={(repo) => repo.id}
          itemRender={(repo) => {
            // 可点条目：仅容器注入 onOpenRepo 时启用；命中 openingRepoId 的行打开中（加载态 + 忽略再次点击）
            const clickable = onOpenRepo !== undefined;
            const opening = repo.id === openingRepoId;
            // 失效：服务端明确回报 valid===false（缺省/true 均按可用处理）
            const invalid = repo.valid === false;
            // 打开分派：失效项先弹确认，其余直接打开
            const openRow = (): void => {
              if (invalid) {
                setInvalidRepo(repo);
                return;
              }
              onOpenRepo?.(repo);
            };
            return (
              <Flex
                data-testid="repo-item"
                align="center"
                gap={8}
                // 整行可点即打开该仓库（未接线则不挂事件，无死控件）；打开中的行不再响应，防连点重复走打开流程
                onClick={clickable && !opening ? openRow : undefined}
                // 行内边距已移除：回归 antd 默认，由 Listy 行容器提供（紧凑密度 8px 8px）。
                // 代价：行容器的内边距不属本元素命中区，点击落在其上不会触发行打开；
                // Listy 无 onItemClick，故「antd 默认内边距」与「整行可点」无法兼得（已由用户裁定接受）。
                // 失效行整体降不透明度（RecentProjectPanel 对失效项的弱化呈现）
                style={{
                  ...(clickable ? { cursor: opening ? 'progress' : 'pointer' } : {}),
                  ...(invalid ? { opacity: 0.6 } : {}),
                }}
              >
                {/* 头像：首字母 + 渐变底（RecentProjectIconHelper 的 AvatarIcon 等价）；色号由服务端下发
                    （缺省 0 = 第一组渐变，兼容只给 RepoInfo 的调用方），失效转灰 + 降不透明度 */}
                <RepoAvatar colorIndex={repo.colorIndex ?? 0} name={repo.name} valid={!invalid} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* 显示名 = 名称 + `  [分支]`（两个空格，对齐 IdeBundle `{0}  [{1}]`）。
                      整串拼在一个 Typography.Text 里：JSX 换行会被折叠，拼字符串才能逐字对上 Java 文案。
                      行**不挂 Tooltip**（既有产品口径：行级气泡与「移除」气泡会叠弹） */}
                  <Typography.Text strong data-testid="repo-display-name">
                    {`${repo.name}${repo.branch ? `  [${repo.branch}]` : ''}`}
                  </Typography.Text>
                  <div>
                    <Typography.Text type="secondary">{relativeToHome(repo.path, homeDir)}</Typography.Text>
                  </div>
                </div>
                {/* 失效标记：小图标承接气泡（信息含路径与 (unavailable) 后缀，对齐 Java 的 tooltip 文案），
                    而不是整行 tooltip——见上方「行不挂 Tooltip」口径 */}
                {invalid ? (
                  <Tooltip
                    title={`${relativeToHome(repo.path, homeDir)} ${UNAVAILABLE_SUFFIX}：该目录已不存在，可能已被移动或删除`}
                  >
                    <WarningOutlined data-testid="repo-invalid" style={{ color: token.colorWarning }} />
                  </Tooltip>
                ) : null}
                {/* 打开中：打开含 POST 往返 + 配置落盘 + 最近列表刷新，有耗时需即时反馈，否则点击似无响应 */}
                {opening ? (
                  <Flex align="center" gap="small" data-testid="repo-opening">
                    <Spin size="small" />
                    <Typography.Text type="secondary">打开中…</Typography.Text>
                  </Flex>
                ) : null}
                {onRemove ? (
                  // 行内操作容器：① 阻断冒泡——Popconfirm 的确认气泡挂在 body portal，
                  // 但 React 合成事件仍按组件树冒泡到本行，不拦会把「移除」连带成「打开该仓库」；
                  // ② 打开中禁用移除——打开往返内删掉该仓库，打开成功会跳进拉不到 status 的白屏页
                  <span
                    style={{ display: 'inline-flex' }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Popconfirm title="移除该仓库？" okText="确定" cancelText="取消" onConfirm={() => onRemove(repo.id)}>
                      <Tooltip title="从最近列表移除（仅移出列表，不删除磁盘上的仓库）">
                        <Button data-testid="repo-remove" type="text" size="small" disabled={opening} icon={<DeleteOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </span>
                ) : null}
              </Flex>
            );
          }}
          // 行包装层只留圆角（悬停底色圆角随它）；行内边距走组件默认（不再手调）
          styles={{ item: { borderRadius: token.borderRadius } }}
        />
      )}
      {onClone ? (
        <CloneModal open={cloneOpen} acting={cloning} onClone={onClone} onClose={() => setCloneOpen(false)} />
      ) : null}
      {onInit ? (
        <InitModal open={initOpen} acting={initializing} onInit={onInit} onClose={() => setInitOpen(false)} />
      ) : null}
      {/* 失效仓库确认（`ReopenProjectAction.showReopenDialog` 的等价）：路径不存在时**不尝试打开**——
          Java 在该分支弹完对话框即 return（`ReopenProjectAction.kt:115-118`），故只给 [关闭 / 从最近列表移除]。
          footer 用显式按钮数组而非默认 ok/cancel：默认两组按钮表达不了「移除」这条危险动作（且 render 函数式
          footer 对 antd 版本较敏感，数组式是文档化用法）；onCancel 保留，供右上角 X 与 ESC 关闭 */}
      <Modal
        open={invalidRepo !== null}
        title="仓库路径不可用"
        onCancel={() => setInvalidRepo(null)}
        footer={[
          ...(onRemove !== undefined && invalidRepo !== null
            ? [
              <Button
                key="remove"
                danger
                data-testid="repo-invalid-remove"
                onClick={() => {
                  onRemove(invalidRepo.id);
                  setInvalidRepo(null);
                }}
              >
                从最近列表移除
              </Button>,
            ]
            : []),
          <Button key="close" data-testid="repo-invalid-close" onClick={() => setInvalidRepo(null)}>
            关闭
          </Button>,
        ]}
      >
        <Flex vertical gap={8}>
          <Typography.Text data-testid="repo-invalid-path">
            {invalidRepo === null ? '' : `${relativeToHome(invalidRepo.path, homeDir)} ${UNAVAILABLE_SUFFIX}`}
          </Typography.Text>
          <Typography.Text type="secondary">该目录已不存在，可能已被移动或删除。</Typography.Text>
        </Flex>
      </Modal>
    </PageShell>
  );
}
