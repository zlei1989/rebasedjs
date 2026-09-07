/**
 * 仓库首页：最近仓库列表 + 打开/克隆/初始化入口。
 * UX 对齐 #3（spec §6.3）：显示名来自注册 name（服务端注册时解析——单级目录名定案，
 * `.idea/.name` 依 spec §2.2 无对应概念，见盘点报告 §4.1）、
 * 路径副文本 user-home 相对化（`~/…`，homeDir 由容器注入）、移除带 Popconfirm 确认、
 * 最近优先/去重/上限 50（服务端与组件同口径）。
 * 克隆/初始化 Modal 对齐 VcsCloneDialog 最小字段集（URL + Directory / 路径表单）。
 * 纯 props 驱动：ui 不调接口，repos/onOpen/onClone/onInit/onRemove/homeDir 由调用方容器注入 hooks 数据。
 */
import { useMemo, useState } from 'react';
import { Button, Flex, Input, Modal, Popconfirm } from 'antd';
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined, SwitcherOutlined } from '@ant-design/icons';
import type { RepoInfo } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { relativeToHome } from './repo-page-utils';

export interface RepoPageProps {
  repos: RepoInfo[];
  /** 打开表单提交（path 为用户输入的仓库路径） */
  onOpen: (path: string) => void;
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
        <Input
          data-testid="clone-url"
          placeholder="仓库 URL（https/ssh/本地路径）"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          data-testid="clone-dir"
          placeholder="目标目录（父目录须存在，git clone 语义）"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
        />
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
        <Input
          data-testid="init-path"
          placeholder="仓库目录（不存在时创建）"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}

export function RepoPage({
  repos,
  onOpen,
  onRemove,
  homeDir = '',
  onClone,
  onInit,
  cloning,
  initializing,
}: RepoPageProps): React.ReactNode {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, maxWidth: 720 }}>
      <Flex gap={8} align="center">
        <Input
          placeholder="仓库路径"
          value={openPath}
          onChange={(e) => setOpenPath(e.target.value)}
          onPressEnter={submitOpen}
        />
        <Button type="primary" icon={<FolderOpenOutlined />} onClick={submitOpen}>
          打开
        </Button>
        {/* 克隆/初始化：入口按钮仅在容器注入回调时渲染（端点未接线时不出现死控件） */}
        {onClone ? (
          <Button icon={<SwitcherOutlined />} loading={cloning} onClick={() => setCloneOpen(true)}>
            克隆
          </Button>
        ) : null}
        {onInit ? (
          <Button icon={<PlusOutlined />} loading={initializing} onClick={() => setInitOpen(true)}>
            初始化
          </Button>
        ) : null}
      </Flex>
      {visible.length === 0 ? (
        <EmptyState title="暂无最近仓库" description="输入路径打开一个 Git 仓库" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visible.map((repo) => (
            <div
              key={repo.id}
              data-testid="repo-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 4px',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{repo.name}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{relativeToHome(repo.path, homeDir)}</div>
              </div>
              {onRemove ? (
                <Popconfirm title="移除该仓库？" okText="确定" cancelText="取消" onConfirm={() => onRemove(repo.id)}>
                  <Button data-testid="repo-remove" size="small" type="text" icon={<DeleteOutlined />} />
                </Popconfirm>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {onClone ? (
        <CloneModal open={cloneOpen} acting={cloning} onClone={onClone} onClose={() => setCloneOpen(false)} />
      ) : null}
      {onInit ? (
        <InitModal open={initOpen} acting={initializing} onInit={onInit} onClose={() => setInitOpen(false)} />
      ) : null}
    </div>
  );
}
