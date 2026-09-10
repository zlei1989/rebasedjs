/**
 * 远程面板（对照 Java GitConfigureRemotesDialog + 远程操作聚合）：
 *  顶部工具条（添加远程 + fetch 全部 + 定制 fetch…——refspec 需点名远程，见契约 fetchBody.refspec）；
 *  远程列表（空态 EmptyState）：行 = name + fetchUrl + 操作（fetch/编辑/删除——删除走 Popconfirm）；
 *  浅克隆徽标 + 「解除浅克隆」（git fetch --unshallow，成功后徽标消失）；
 *  添加远程 Modal（name+url 双输入）；编辑远程 Modal（单 url 输入，预填当前 fetchUrl，契约 setUrl 同时改写 fetch/push URL）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Select, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { RemoteAction, RemoteInfo, RemoteList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';

export interface RemotePanelProps {
  remotes: RemoteList;
  onAction: (a: RemoteAction) => void;
  onFetch: (remote?: string) => void;
  /** 定制 refspec fetch（refspec 必填、远程必选——契约侧与 --all 互斥）；缺省不渲染「定制 Fetch…」 */
  onFetchSpec?: (remote: string, refspec: string) => void;
  /** 解除浅克隆（git fetch --unshallow）；缺省不渲染「解除浅克隆」 */
  onUnshallow?: (remote: string) => void;
  acting?: boolean;
}

/** 添加远程 Modal：name+url 双输入（均必填）；关闭时复位输入（Modal 默认不卸载子树，取消后重开不能残留上次输入） */
function AddRemoteModal({
  open,
  acting,
  onAction,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onAction: (a: RemoteAction) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const close = (): void => {
    setName('');
    setUrl('');
    onClose();
  };

  const submit = (): void => {
    onAction({ action: 'add', name: name.trim(), url: url.trim() });
    close();
  };

  return (
    <Modal
      title="添加远程"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' || url.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={8}>
        <Input
          data-testid="add-remote-name"
          placeholder="远程名（如 origin）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          data-testid="add-remote-url"
          placeholder="远程 URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}

/** 编辑远程 Modal：单 url 输入；调用方以 key={remote.name} 强制按目标重挂载，故初始值即当前 fetchUrl 无需手动同步 */
function EditRemoteModal({
  remote,
  acting,
  onAction,
  onClose,
}: {
  remote: RemoteInfo;
  acting?: boolean;
  onAction: (a: RemoteAction) => void;
  onClose: () => void;
}): React.ReactNode {
  const [url, setUrl] = useState(remote.fetchUrl);

  /** 关闭时复位回当前 fetchUrl（Modal 默认不卸载子树，取消后重开不能残留上次输入） */
  const close = (): void => {
    setUrl(remote.fetchUrl);
    onClose();
  };

  const submit = (): void => {
    onAction({ action: 'setUrl', name: remote.name, url: url.trim() });
    onClose();
  };

  return (
    <Modal
      title={`编辑远程：${remote.name}`}
      open
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: url.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Input
        data-testid="edit-remote-url"
        placeholder="远程 URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
    </Modal>
  );
}

/** 远程行：name + fetchUrl + 操作（fetch/编辑/删除——删除走 Popconfirm，直接包裹按钮故用非受控） */
function RemoteRow({
  remote,
  onAction,
  onFetch,
  onEdit,
}: {
  remote: RemoteInfo;
  onAction: (a: RemoteAction) => void;
  onFetch: (remote?: string) => void;
  onEdit: (remote: RemoteInfo) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-remote-${remote.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text strong style={{ minWidth: 80 }}>
        {remote.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ flex: 1, minWidth: 0 }} ellipsis>
        {remote.fetchUrl}
      </Typography.Text>
      <Button size="small" data-testid={`fetch-remote-${remote.name}`} onClick={() => onFetch(remote.name)}>
        Fetch
      </Button>
      <Button size="small" data-testid={`edit-remote-${remote.name}`} onClick={() => onEdit(remote)}>
        编辑
      </Button>
      <Popconfirm
        title={`确定删除远程 ${remote.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'remove', name: remote.name })}
      >
        <Button size="small" danger data-testid={`remove-remote-${remote.name}`}>
          删除
        </Button>
      </Popconfirm>
    </Flex>
  );
}

/** 定制 refspec fetch Modal：远程必选（Select）+ refspec 必填（Input）；关闭复位 */
function FetchSpecModal({
  open,
  remotes,
  acting,
  onSubmit,
  onClose,
}: {
  open: boolean;
  remotes: RemoteInfo[];
  acting?: boolean;
  onSubmit: (remote: string, refspec: string) => void;
  onClose: () => void;
}): React.ReactNode {
  const [remote, setRemote] = useState<string | undefined>(undefined);
  const [refspec, setRefspec] = useState('');

  const close = (): void => {
    setRemote(undefined);
    setRefspec('');
    onClose();
  };

  return (
    <Modal
      title="定制 Fetch（refspec）"
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={acting}
      okButtonProps={{ disabled: remote === undefined || refspec.trim() === '' }}
      onOk={() => {
        if (remote === undefined || refspec.trim() === '') return;
        onSubmit(remote, refspec.trim());
        close();
      }}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          按 refspec 拉取指定引用（如 +refs/pull/7/head:refs/remotes/origin/pr-7）；refspec 需指定远程。
        </Typography.Text>
        <Select
          data-testid="fetch-spec-remote"
          placeholder="选择远程"
          value={remote}
          options={remotes.map((r) => ({ value: r.name, label: r.name }))}
          onChange={setRemote}
        />
        <Input
          data-testid="fetch-spec-refspec"
          placeholder="refspec（如 +refs/heads/*:refs/remotes/origin/*）"
          value={refspec}
          onChange={(e) => setRefspec(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}

export function RemotePanel({ remotes, onAction, onFetch, onFetchSpec, onUnshallow, acting }: RemotePanelProps): React.ReactNode {
  const [addOpen, setAddOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RemoteInfo | null>(null);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      {/* 顶部工具条：添加远程 + fetch 全部（无参 onFetch 表示全部远程） */}
      <Flex gap={8}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          data-testid="add-remote-button"
          onClick={() => setAddOpen(true)}
        >
          添加远程
        </Button>
        <Button data-testid="fetch-all-button" loading={acting} onClick={() => onFetch()}>
          Fetch 全部
        </Button>
        {onFetchSpec !== undefined && (
          <Button data-testid="fetch-spec-button" onClick={() => setSpecOpen(true)}>
            定制 Fetch…
          </Button>
        )}
      </Flex>

      <Card size="small" title={`远程列表（${remotes.remotes.length}）`}>
        {/* shallow 识别徽标 + 解除浅克隆：浅克隆仓库提示，解除走 fetch --unshallow（成功后徽标随之消失） */}
        {remotes.shallow && (
          <Flex align="center" gap={8} style={{ marginBottom: 8 }} wrap>
            <Tag color="orange" data-testid="shallow-badge">
              浅克隆（历史截断）
            </Tag>
            {onUnshallow !== undefined && (
              <Button
                size="small"
                data-testid="unshallow-button"
                loading={acting}
                onClick={() => onUnshallow(remotes.remotes[0]?.name ?? '')}
              >
                解除浅克隆
              </Button>
            )}
          </Flex>
        )}
        {remotes.remotes.length === 0 ? (
          <EmptyState title="暂无远程" />
        ) : (
          <Flex vertical>
            {remotes.remotes.map((remote) => (
              <RemoteRow
                key={remote.name}
                remote={remote}
                onAction={onAction}
                onFetch={onFetch}
                onEdit={setEditTarget}
              />
            ))}
          </Flex>
        )}
      </Card>

      <AddRemoteModal
        open={addOpen}
        acting={acting}
        onAction={onAction}
        onClose={() => setAddOpen(false)}
      />
      {onFetchSpec !== undefined && (
        <FetchSpecModal
          open={specOpen}
          remotes={remotes.remotes}
          acting={acting}
          onSubmit={onFetchSpec}
          onClose={() => setSpecOpen(false)}
        />
      )}
      {/* 编辑 Modal 以 key 按目标重挂载：切换编辑对象时 url 初始值随之刷新为对应 fetchUrl */}
      {editTarget !== null && (
        <EditRemoteModal
          key={editTarget.name}
          remote={editTarget}
          acting={acting}
          onAction={onAction}
          onClose={() => setEditTarget(null)}
        />
      )}
    </Flex>
  );
}
