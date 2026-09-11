/**
 * 补丁面板（对照 patch 存档动作面）：
 *  顶部「创建补丁」按钮开 Modal（name 必填 + 范围 Radio：工作区 / 暂存 / 提交区间——两输入框均可空，
 *  空侧省略，服务端按"单侧缺省=HEAD"裁定）；
 *  底部补丁列表 Card（空态 EmptyState）：行 = name + 大小（字节格式化）+ 创建时间 + 操作
 *  （应用 / 导入搁置 / 删除 Popconfirm）。
 *  载荷映射（控制器裁定，沿 tag/stash 的 optional 缺省省略惯例）：
 *  工作区 → {name}（省略 staged，服务端缺省视为 false → git diff HEAD）；
 *  暂存 → {name, staged:true}；提交区间 → {name, from?, to?}。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 *  所有可交互元素（按钮/输入/单选组及其选项）均一对一包 Tooltip，说明作用对象与后果。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Radio, Tooltip, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { PatchCreateBody, PatchEntry, PatchList } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { Toolbar } from '../base/toolbar';
import { formatCommitDate } from '../domain/format';

export interface PatchPanelProps {
  patches: PatchList;
  onCreate: (body: PatchCreateBody) => void;
  onApply: (name: string) => void;
  onImportShelf: (name: string) => void;
  onDelete: (name: string) => void;
  acting?: boolean;
}

/** 创建范围：工作区 = git diff HEAD（暂存+未暂存全量）；暂存 = git diff --cached；提交区间 = diff <from> <to> */
type CreateScope = 'workspace' | 'staged' | 'range';

/** 字节格式化：<1KB 显示 B，<1MB 显示 KB，其余 MB（一位小数）——format.ts 无字节助手，本地简单实现 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 补丁行：name + 大小 + 创建时间 + 应用（直发）/ 导入搁置（直发）/ 删除（Popconfirm 确认）；acting 期间行按钮禁用防重复 */
function PatchRow({
  patch,
  acting,
  onApply,
  onImportShelf,
  onDelete,
}: {
  patch: PatchEntry;
  acting?: boolean;
  onApply: (name: string) => void;
  onImportShelf: (name: string) => void;
  onDelete: (name: string) => void;
}): React.ReactNode {
  return (
    <Flex data-testid={`row-patch-${patch.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {patch.name}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatBytes(patch.size)}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(patch.createdAtIso)}
      </Typography.Text>
      {/* 行内按钮在 acting 期间禁用；禁用按钮不派发 hover，故在 Tooltip 与 Button 之间包一层 span 承接悬停 */}
      <Tooltip title={acting ? '操作进行中：等结束后再应用该补丁' : '把该补丁的变更应用到当前工作区（不生成提交）'}>
        <span>
          <Button size="small" data-testid={`apply-patch-${patch.name}`} disabled={acting} onClick={() => onApply(patch.name)}>
            应用
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={acting ? '操作进行中：等结束后再导入该补丁' : '把该补丁转为搁置条目（不落到工作区）'}>
        <span>
          <Button size="small" data-testid={`import-patch-${patch.name}`} disabled={acting} onClick={() => onImportShelf(patch.name)}>
            导入搁置
          </Button>
        </span>
      </Tooltip>
      {/* Popconfirm 触发按钮同样要能承接禁用态的悬停：Popconfirm > Tooltip > span > Button */}
      <Popconfirm
        title={`确定删除补丁 ${patch.name}？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onDelete(patch.name)}
      >
        <Tooltip title={acting ? '操作进行中：等结束后再删除该补丁' : '删除补丁文件（磁盘上不可恢复）'}>
          <span>
            <Button size="small" danger data-testid={`delete-patch-${patch.name}`} disabled={acting}>
              删除
            </Button>
          </span>
        </Tooltip>
      </Popconfirm>
    </Flex>
  );
}

/** 创建补丁 Modal：name 必填（空则确定禁用）+ 范围 Radio；from/to 仅在提交区间展示且均可空 */
function CreatePatchModal({
  open,
  acting,
  onCreate,
  onClose,
}: {
  open: boolean;
  acting?: boolean;
  onCreate: (body: PatchCreateBody) => void;
  onClose: () => void;
}): React.ReactNode {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<CreateScope>('workspace');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /** 关闭时复位全部输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setName('');
    setScope('workspace');
    setFrom('');
    setTo('');
    onClose();
  };

  /** 提交并复位：按范围映射载荷；from/to 仅非空时携带（服务端单侧缺省=HEAD） */
  const submit = (): void => {
    const trimmedName = name.trim();
    if (scope === 'staged') {
      onCreate({ name: trimmedName, staged: true });
    } else if (scope === 'range') {
      const trimmedFrom = from.trim();
      const trimmedTo = to.trim();
      onCreate({
        name: trimmedName,
        ...(trimmedFrom === '' ? {} : { from: trimmedFrom }),
        ...(trimmedTo === '' ? {} : { to: trimmedTo }),
      });
    } else {
      // 工作区：省略 staged（缺省 false → git diff HEAD）
      onCreate({ name: trimmedName });
    }
    close();
  };

  return (
    <Modal
      title="创建补丁"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: name.trim() === '' }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Tooltip title="补丁名（必填）：作为落盘文件名，留空时「确定」保持禁用">
          <Input
            data-testid="patch-create-name"
            placeholder="补丁名（必填）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Tooltip>
        {/* Radio.Group 自身算一个控件；组内每个 Radio 也是控件（会被外层组遮挡），故内外各包一个 Tooltip */}
        <Tooltip title="补丁范围：决定从哪些变更生成补丁，切换后下方输入框随之变化">
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as CreateScope)}>
            <Flex gap={16}>
              <Tooltip title="工作区：导出全部未提交变更，含已暂存内容（等价 git diff HEAD）">
                <Radio value="workspace">工作区</Radio>
              </Tooltip>
              <Tooltip title="暂存区：只导出已 add 进索引的内容（等价 git diff --cached）">
                <Radio value="staged">暂存</Radio>
              </Tooltip>
              <Tooltip title="提交区间：按起点到终点的两个版本取差异，选中后额外出现两个输入框">
                <Radio value="range">提交区间</Radio>
              </Tooltip>
            </Flex>
          </Radio.Group>
        </Tooltip>
        {scope === 'range' ? (
          <Flex vertical gap={8}>
            <Tooltip title="起点（可空）：留空则该侧按 HEAD 取；支持分支名或提交号">
              <Input
                data-testid="patch-create-from"
                placeholder="起点（分支/提交，可空默认 HEAD）"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Tooltip>
            <Tooltip title="终点（可空）：留空则该侧按 HEAD 取；与起点构成 diff 的两个端点">
              <Input
                data-testid="patch-create-to"
                placeholder="终点（分支/提交，可空默认 HEAD）"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Tooltip>
          </Flex>
        ) : null}
      </Flex>
    </Modal>
  );
}

export function PatchPanel({ patches, onCreate, onApply, onImportShelf, onDelete, acting }: PatchPanelProps): React.ReactNode {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      {/* 顶部工具行改 Toolbar：原 Flex 无 gap（照抄：不传 gap 即不落 style），
          由原语统一 flexWrap + width:100% + minWidth:0；唯一子项是按钮，无需补 minWidth:0。 */}
      <Toolbar>
        <Tooltip title="生成补丁文件存到仓库的补丁目录（打开命名与范围弹窗）">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            data-testid="patch-create-button"
            loading={acting}
            onClick={() => setCreateOpen(true)}
          >
            创建补丁
          </Button>
        </Tooltip>
      </Toolbar>
      <Card size="small" title={`补丁列表（${patches.patches.length}）`}>
        {patches.patches.length === 0 ? (
          <EmptyState title="暂无补丁" />
        ) : (
          <Flex vertical>
            {patches.patches.map((patch) => (
              <PatchRow
                key={patch.name}
                patch={patch}
                acting={acting}
                onApply={onApply}
                onImportShelf={onImportShelf}
                onDelete={onDelete}
              />
            ))}
          </Flex>
        )}
      </Card>
      <CreatePatchModal
        open={createOpen}
        acting={acting}
        onCreate={onCreate}
        onClose={() => setCreateOpen(false)}
      />
    </Flex>
  );
}
