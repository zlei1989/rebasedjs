/**
 * 进行中操作条：merge/rebase/cherry-pick/revert 的中文状态 + 中止按钮（Popconfirm 确认）；none 时不渲染。
 * 纯 props 驱动：ui 不调接口，operation/onAbort/aborting 由调用方容器注入 hooks 数据。
 */
import { Button, Popconfirm, Space, Tag, Tooltip } from 'antd';
import type { OperationState } from '@rebased/contracts';

export interface OperationStatusProps {
  /** 进行中操作状态（kind 为 none 时组件不渲染） */
  operation: OperationState;
  /** 中止确认后回调 */
  onAbort: () => void;
  /** 中止请求进行中：按钮进入 loading 态 */
  aborting?: boolean;
}

/** kind → 中文文案；rebase 有 step/total 时追加「（第 step/total 步）」进度 */
function operationLabel(operation: OperationState): string {
  switch (operation.kind) {
    case 'merge':
      return '合并中';
    case 'rebase':
      return operation.step != null && operation.total != null
        ? `变基中（第 ${operation.step}/${operation.total} 步）`
        : '变基中';
    case 'cherry-pick':
      return '拣选中';
    case 'revert':
      return '还原中';
    default:
      return '';
  }
}

export function OperationStatus({ operation, onAbort, aborting = false }: OperationStatusProps): React.ReactNode {
  if (operation.kind === 'none') return null;
  return (
    <Space size={8}>
      <Tag color="warning">{operationLabel(operation)}</Tag>
      <Popconfirm
        title="确定中止当前操作？工作区将回到操作前状态"
        okText="确定"
        cancelText="取消"
        onConfirm={onAbort}
      >
        {/* Tooltip 置于 Popconfirm 内侧（Popconfirm > Tooltip > Button），保持取消确认的触发链完整；
            文案说明中止的后果（工作区回到操作前、已做的解决会被丢弃），且外层确认气泡还要再点一次 */}
        <Tooltip title="放弃本次进行中的操作：工作区恢复到操作前状态，已完成的冲突解决不会保留">
          <Button danger size="small" loading={aborting}>
            中止
          </Button>
        </Tooltip>
      </Popconfirm>
    </Space>
  );
}
