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
 */
import { useMemo, useState } from 'react';
import { Button, Flex, Input, Listy, Modal, Popconfirm, Spin, theme, Tooltip } from 'antd';
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, SettingOutlined, SwitcherOutlined } from '@ant-design/icons';
import type { RepoInfo } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { PageShell } from '../base/page-shell';
import { relativeToHome } from './repo-page-utils';

export interface RepoPageProps {
  repos: RepoInfo[];
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
  /** 设置入口（欢迎屏 Configure → SettingsPage 语义）：点击以最近仓库 id 回调；无最近仓库时禁用；缺省不渲染 */
  onOpenSettings?: (repoId: string) => void;
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
  // 最近优先（openedAt 降序）→ 同路径去重（保留最近一条）→ 截断上限 50
  const visible = useMemo(() => {
    const sorted = [...repos].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const seen = new Set<string>();
    const out: RepoInfo[] = [];
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
      <Flex gap={8} align="center" wrap>
        <Tooltip title="仓库路径：支持 ~ 前缀，回车等同点「打开」">
          <Input
            placeholder="仓库路径"
            value={openPath}
            onChange={(e) => setOpenPath(e.target.value)}
            onPressEnter={submitOpen}
            style={{ minWidth: 200, flex: 1 }}
          />
        </Tooltip>
        <Tooltip title="打开该路径：校验并注册为最近仓库，随后进入提交日志页">
          <Button type="primary" icon={<FolderOpenOutlined />} onClick={submitOpen}>
            打开
          </Button>
        </Tooltip>
        {/* 克隆/初始化：入口按钮仅在容器注入回调时渲染（端点未接线时不出现死控件） */}
        {onClone ? (
          <Tooltip title="从远程 URL 克隆一个新仓库到本地目录">
            <Button icon={<SwitcherOutlined />} loading={cloning} onClick={() => setCloneOpen(true)}>
              克隆
            </Button>
          </Tooltip>
        ) : null}
        {onInit ? (
          <Tooltip title="在指定目录新建（git init）一个空仓库">
            <Button icon={<PlusOutlined />} loading={initializing} onClick={() => setInitOpen(true)}>
              初始化
            </Button>
          </Tooltip>
        ) : null}
        {/* 设置入口（欢迎屏 Configure 语义）：以最近仓库进入设置页（设置按仓库 git 配置呈现）；无仓库时禁用 */}
        {onOpenSettings ? (
          // 禁用按钮不派发 hover，按 antd 做法在 Tooltip 与 Button 间包一层 span 承接提示
          <Tooltip
            title={
              visible.length === 0
                ? '暂无最近仓库：设置项按仓库 git 配置呈现，先打开一个仓库'
                : '打开最近仓库的设置页（git 配置 / 账户 / 外观）'
            }
          >
            <span>
              <Button
                icon={<SettingOutlined />}
                disabled={visible.length === 0}
                data-testid="open-settings-button"
                onClick={() => {
                  if (visible[0] !== undefined) onOpenSettings(visible[0].id);
                }}
              >
                设置
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </Flex>
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
            return (
              <Flex
                data-testid="repo-item"
                align="center"
                gap={8}
                // 整行可点即打开该仓库（未接线则不挂事件，无死控件）；打开中的行不再响应，防连点重复走打开流程
                onClick={clickable && !opening ? () => onOpenRepo(repo) : undefined}
                // 行内边距留在**可点元素自身**（不能下沉到 Listy 的 styles.item：那层是包装 div，
                // 它的 padding 既不属于本元素的命中区，点击落在内边距上也不会触发打开）；光标在打开中给 progress
                style={{
                  padding: '8px 4px',
                  ...(clickable ? { cursor: opening ? 'progress' : 'pointer' } : {}),
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{repo.name}</div>
                  <div style={{ color: token.colorTextSecondary, fontSize: 12 }}>{relativeToHome(repo.path, homeDir)}</div>
                </div>
                {/* 打开中：打开含 POST 往返 + 配置落盘 + 最近列表刷新，有耗时需即时反馈，否则点击似无响应 */}
                {opening ? (
                  <Flex align="center" gap={6} data-testid="repo-opening">
                    <Spin size="small" />
                    <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>打开中…</span>
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
                        <Button data-testid="repo-remove" type="text" disabled={opening} icon={<DeleteOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </span>
                ) : null}
              </Flex>
            );
          }}
          // 行包装层只留圆角（悬停底色圆角随它）；内边距在行元素上 —— 保证整行命中区与改造前一致
          styles={{ item: { padding: 0, borderRadius: token.borderRadius } }}
        />
      )}
      {onClone ? (
        <CloneModal open={cloneOpen} acting={cloning} onClone={onClone} onClose={() => setCloneOpen(false)} />
      ) : null}
      {onInit ? (
        <InitModal open={initOpen} acting={initializing} onInit={onInit} onClose={() => setInitOpen(false)} />
      ) : null}
    </PageShell>
  );
}
