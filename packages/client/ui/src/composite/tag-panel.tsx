/**
 * 标签面板（对照 Java GitTagPanel 的标签列表 + 新建标签动作面）：
 *  列表（name + annotated 徽标 + subject + 操作：推送/删除 Popconfirm）
 *  + 创建 Modal（name 必填 + ref 可空默认 HEAD + message 可空——非空即附注标签）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 *  所有可交互元素（按钮/输入）均一对一包 Tooltip；Popconfirm 触发按钮的 Tooltip 放最内层。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { TagAction, TagEntry, TagList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { EllipsisText } from '../base/ellipsis-text';
import { Toolbar } from '../base/toolbar';

export interface TagPanelProps {
  tags: TagList;
  onAction: (action: TagAction) => void;
  /** 标签操作进行中：创建 Modal 确定按钮 loading 态 */
  acting?: boolean;
}

/** 标签行：name + annotated 徽标 + subject（轻量标签 subject 为 null 时不渲染）+ 推送/删除远程/删除 */
function TagRow({ tag, onAction }: { tag: TagEntry; onAction: (action: TagAction) => void }): React.ReactNode {
  return (
    <Flex data-testid={`tag-row-${tag.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      {/* 标签名是不可断行串（分支/版本号风格的 ref 名），同行还有附注徽标 + flex:1 的 subject + 3 个按钮；
          原写法 `strong` + `flexShrink: 0` 使它的自动最小尺寸等于整个标签名，与固定宽度的兄弟一起把行顶宽
          （360px 内容盒约 313px，固定兄弟已占约 240px），`ellipsis` 因而不可能生效。
          改用原语：`strong` 保留字重（Ruling P17(c)：为可截断加 `strong` 透传，不必牺牲原有呈现），
          `flexShrink: 0` 去掉 —— 可被挤压正是截断生效的前提；`minWidth: 0` 由原语自带，故这里无需再写 style。 */}
      <EllipsisText strong title={tag.name}>
        {tag.name}
      </EllipsisText>
      {/* 附注徽标：annotated=true 时展示（轻量标签不渲染） */}
      {tag.annotated ? <Tag color="gold">附注</Tag> : null}
      {tag.subject !== null ? (
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {tag.subject}
        </Typography.Text>
      ) : (
        // 轻量标签占位：与附注行保持对齐
        <Typography.Text style={{ flex: 1, minWidth: 0 }} />
      )}
      {/* 推送/删除远程/删除均走 Popconfirm：三者都是对外部状态的一步操作，误触成本高（对照 stash 的 pop/drop 确认约定） */}
      <Popconfirm
        title={`推送标签 ${tag.name} 到远程仓库？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'push', name: tag.name })}
      >
        {/* Popconfirm 的触发按钮：Tooltip 放最内层，避免截断其点击触发链 */}
        <Tooltip title="把该标签推到远程同名标签（远程已存在同名标签时会被拒绝）">
          <Button size="small" data-testid={`tag-push-${tag.name}`}>
            推送
          </Button>
        </Tooltip>
      </Popconfirm>
      <Popconfirm
        title={`确定从远程删除标签 ${tag.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'deleteRemote', name: tag.name })}
      >
        <Tooltip title="删除远程仓库上的该标签（本地标签不受影响，仍留在列表里）">
          <Button size="small" danger data-testid={`tag-delete-remote-${tag.name}`}>
            删除远程
          </Button>
        </Tooltip>
      </Popconfirm>
      <Popconfirm
        title={`确定删除标签 ${tag.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onAction({ action: 'delete', name: tag.name })}
      >
        <Tooltip title="删除本地该标签（远程同名标签需用「删除远程」另行清理）">
          <Button size="small" danger data-testid={`tag-delete-${tag.name}`}>
            删除
          </Button>
        </Tooltip>
      </Popconfirm>
    </Flex>
  );
}

/** 创建标签 Modal：name 必填 + ref 可空（缺省 HEAD）+ message 可空（非空 → 附注标签） */
function CreateTagModal({
  open,
  acting,
  onAction,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onAction: (action: TagAction) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [message, setMessage] = useState('');

  /** 关闭时复位三个输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setName('');
    setRef('');
    setMessage('');
    onClose();
  };

  /** 提交并复位：ref/message 仅非空时携带（契约 create 的 ref/message 均 optional；message 非空 → 附注标签） */
  const submit = (): void => {
    const trimmedName = name.trim();
    const trimmedRef = ref.trim();
    const trimmedMessage = message.trim();
    onAction({
      action: 'create',
      name: trimmedName,
      ...(trimmedRef === '' ? {} : { ref: trimmedRef }),
      ...(trimmedMessage === '' ? {} : { message: trimmedMessage }),
    });
    close();
  };

  return (
    <Modal
      title="新建标签"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={8}>
        <Tooltip title="标签名（必填）：与已有标签重名会被拒绝，留空时「确定」保持禁用">
          <Input
            data-testid="tag-create-name"
            placeholder="标签名（必填）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="指向的引用（可空）：留空即以当前 HEAD 打标，也可填分支名或提交号">
          <Input
            data-testid="tag-create-ref"
            placeholder="引用（可空，默认 HEAD）"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="附注信息（可空）：填了创建附注标签，留空则创建轻量标签">
          <Input
            data-testid="tag-create-message"
            placeholder="附注信息（可空；非空即附注标签）"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Tooltip>
      </Flex>
    </Modal>
  );
}

export function TagPanel({ tags, onAction, acting }: TagPanelProps): React.ReactNode {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      {/* 顶部工具条：新建标签 + 推送全部。
          横向工具行改 Toolbar（gap 照抄原值 8；交叉轴 align 固定 center，与原 align="center" 等价），
          统一 flexWrap + width:100% + minWidth:0；子项均为按钮，无需补 minWidth:0。 */}
      <Toolbar gap={8}>
        <Tooltip title="创建一个新标签（打开名称 / 引用 / 附注信息弹窗）">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            data-testid="tag-create-button"
            loading={acting}
            onClick={() => setCreateOpen(true)}
          >
            新建标签
          </Button>
        </Tooltip>
        {/* 推送全部标签（GitPushTagsActionGroup 语义）：Popconfirm 确认后一键推全部本地标签 */}
        <Popconfirm
          title="推送全部标签到远程仓库？"
          okText="确定"
          cancelText="取消"
          onConfirm={() => onAction({ action: 'pushAll' })}
        >
          <Tooltip title="一次性把本地全部标签推到远程（标签多时耗时较长，远程同名会被拒绝）">
            <Button data-testid="tag-push-all" loading={acting}>
              推送全部
            </Button>
          </Tooltip>
        </Popconfirm>
      </Toolbar>
      <Card size="small" title={`标签列表（${tags.tags.length}）`}>
        {tags.tags.length === 0 ? (
          <EmptyState title="暂无标签" />
        ) : (
          <Flex vertical>
            {tags.tags.map((tag) => (
              <TagRow key={tag.name} tag={tag} onAction={onAction} />
            ))}
          </Flex>
        )}
      </Card>
      <CreateTagModal
        open={createOpen}
        acting={acting}
        onAction={onAction}
        onClose={() => setCreateOpen(false)}
      />
    </Flex>
  );
}
