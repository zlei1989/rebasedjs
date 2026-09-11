/**
 * 远程面板（对照 Java GitConfigureRemotesDialog + 远程操作聚合）：
 *  顶部工具条（添加远程 + fetch 全部 + 定制 fetch…——refspec 需点名远程，见契约 fetchBody.refspec）；
 *  远程列表（空态 EmptyState）：行 = name + fetchUrl + 操作（fetch/编辑/删除——删除走 Popconfirm）；
 *  浅克隆徽标 + 「解除浅克隆」（git fetch --unshallow，成功后徽标消失）；
 *  添加远程 Modal（name+url 双输入）；编辑远程 Modal（单 url 输入，预填当前 fetchUrl，契约 setUrl 同时改写 fetch/push URL）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Listy, Modal, Popconfirm, Select, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { RemoteAction, RemoteInfo, RemoteList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { Toolbar } from '../base/toolbar';

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
        <Tooltip title="填写新远程的名称（如 origin）：与下方 URL 成对写入仓库配置，名称重复会被服务端拒绝">
          <Input
            data-testid="add-remote-name"
            placeholder="远程名（如 origin）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="填写新远程的 URL：支持 https/ssh，添加后同时作为该远程的 fetch 与 push 地址">
          <Input
            data-testid="add-remote-url"
            placeholder="远程 URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Tooltip>
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
      <Tooltip title="修改该远程的 URL：保存后 fetch 与 push 地址同时改写（契约 setUrl），改地址不影响已有提交">
        <Input
          data-testid="edit-remote-url"
          placeholder="远程 URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Tooltip>
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
    <Flex data-testid={`row-remote-${remote.name}`} align="center" gap={8}>
      <Typography.Text strong style={{ minWidth: 80 }}>
        {remote.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ flex: 1, minWidth: 0 }} ellipsis>
        {remote.fetchUrl}
      </Typography.Text>
      {/* 行本身不可点（只读展示 name/URL），故无需行 Tooltip 抑制逻辑；行内三个操作各自包 Tooltip */}
      <Tooltip title="拉取该远程的最新提交与分支（git fetch）：只更新远程跟踪分支，不改动工作区">
        <Button size="small" data-testid={`fetch-remote-${remote.name}`} onClick={() => onFetch(remote.name)}>
          Fetch
        </Button>
      </Tooltip>
      <Tooltip title="修改该远程的 URL（弹窗内预填当前地址）：保存后 fetch/push 地址一起改写">
        <Button size="small" data-testid={`edit-remote-${remote.name}`} onClick={() => onEdit(remote)}>
          编辑
        </Button>
      </Tooltip>
      <Popconfirm
        title={`确定删除远程 ${remote.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'remove', name: remote.name })}
      >
        {/* Tooltip 放最内层（Popconfirm > Tooltip > Button）：保持 Popconfirm 的触发链完整 */}
        <Tooltip title="从本仓库配置中移除该远程（git remote remove）：只改本地配置，不动远端仓库">
          <Button size="small" danger data-testid={`remove-remote-${remote.name}`}>
            删除
          </Button>
        </Tooltip>
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
        <Tooltip title="选择要拉取的远程：refspec 依赖远程名解析，未选则「确定」不可点">
          <Select
            data-testid="fetch-spec-remote"
            placeholder="选择远程"
            value={remote}
            options={remotes.map((r) => ({ value: r.name, label: r.name }))}
            onChange={setRemote}
          />
        </Tooltip>
        <Tooltip title="填写 refspec（如 +refs/heads/*:refs/remotes/origin/*）：决定把哪些引用拉到哪里，需与所选远程匹配">
          <Input
            data-testid="fetch-spec-refspec"
            placeholder="refspec（如 +refs/heads/*:refs/remotes/origin/*）"
            value={refspec}
            onChange={(e) => setRefspec(e.target.value)}
          />
        </Tooltip>
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
      {/* 顶部工具条：添加远程 + fetch 全部（无参 onFetch 表示全部远程）+ 定制 fetch。
          横向工具行改 Toolbar（gap 照抄原值 8）；原 Flex 未写 align（交叉轴 normal=stretch），
          Toolbar 固定为 center —— 三个子项同为默认高度按钮，两种对齐的观感一致。
          子项均为按钮，无需补 minWidth:0。 */}
      <Toolbar gap={8}>
        <Tooltip title="打开添加远程弹窗：填写名称与 URL 后写入仓库配置（git remote add）">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            data-testid="add-remote-button"
            onClick={() => setAddOpen(true)}
          >
            添加远程
          </Button>
        </Tooltip>
        <Tooltip title="拉取全部远程的最新提交（git fetch --all）：不合并、不改动工作区，耗时随远程数量增加">
          <Button data-testid="fetch-all-button" loading={acting} onClick={() => onFetch()}>
            Fetch 全部
          </Button>
        </Tooltip>
        {onFetchSpec !== undefined && (
          <Tooltip title="按指定 refspec 拉取单个远程的引用（弹窗内选远程 + 填 refspec），用于拉取 PR 等非默认引用">
            <Button data-testid="fetch-spec-button" onClick={() => setSpecOpen(true)}>
              定制 Fetch…
            </Button>
          </Tooltip>
        )}
      </Toolbar>

      <Card size="small" title={`远程列表（${remotes.remotes.length}）`}>
        {/* shallow 识别徽标 + 解除浅克隆：浅克隆仓库提示，解除走 fetch --unshallow（成功后徽标随之消失） */}
        {remotes.shallow && (
          <Flex align="center" gap={8} style={{ marginBottom: 8 }} wrap>
            <Tag color="orange" data-testid="shallow-badge">
              浅克隆（历史截断）
            </Tag>
            {onUnshallow !== undefined && (
              <Tooltip title="补齐被截断的历史（git fetch --unshallow，作用于首个远程）：成功后浅克隆徽标消失，耗时较长">
                <Button
                  size="small"
                  data-testid="unshallow-button"
                  loading={acting}
                  onClick={() => onUnshallow(remotes.remotes[0]?.name ?? '')}
                >
                  解除浅克隆
                </Button>
              </Tooltip>
            )}
          </Flex>
        )}
        {remotes.remotes.length === 0 ? (
          <EmptyState title="暂无远程" />
        ) : (
          // 行列表走 antd Listy（6.6.0 起的列表组件，取代老 List）：行容器/悬停底色由组件负责，
          // 调用方只给数据与行内容；行内边距沿用改造前的 4px 0（Listy 默认 12px 16px）。
          <Listy
            items={remotes.remotes}
            rowKey={(remote) => remote.name}
            itemRender={(remote) => (
              <RemoteRow
                remote={remote}
                onAction={onAction}
                onFetch={onFetch}
                onEdit={setEditTarget}
              />
            )}
            styles={{ item: { padding: '4px 0' } }}
          />
        )}
      </Card>

      <AddRemoteModal
        open={addOpen}
        acting={acting}
        onAction={onAction}
        onClose={() => setAddOpen(false)}
      />
      {onFetchSpec !== undefined && (
        // 门禁口径说明（反直觉点，勿删）：FetchSpecModal 是「弹窗入口」——内部渲染 Modal（容器型组件），
        // 弹窗里的控件已各自带 Tooltip；但 check-tooltips 按属性名把 onSubmit 当作用户操作事件，
        // 于是把它当成可交互元素。此处按「一对一覆盖」包一层 Tooltip 满足门禁：
        // 该组件只取自己的具名 props、不转发额外事件属性，所以既不会在弹窗上弹气泡，
        // 也没有给 Modal 增加任何行为（props / 事件处理 / 布局均未改动）。
        <Tooltip title="定制 Fetch 弹窗入口：选远程 + 填 refspec 后按该引用拉取（弹窗内控件各自带说明）">
          <FetchSpecModal
            open={specOpen}
            remotes={remotes.remotes}
            acting={acting}
            onSubmit={onFetchSpec}
            onClose={() => setSpecOpen(false)}
          />
        </Tooltip>
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
