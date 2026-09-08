/**
 * Update Project 对话框（对照 Java GitUpdateOptionsDialog）：
 *  策略 Radio（merge/rebase，默认 merge）——update = fetch 全部 + 按策略合入当前分支。
 *  纯受控：open 由父级持有；策略为内部状态，关闭时复位为 merge。
 */
import { useState } from 'react';
import { Button, Flex, Modal, Radio, Typography } from 'antd';
import type { UpdateBody } from '@rebased/contracts';

export interface UpdateProjectDialogProps {
  open: boolean;
  onOk: (b: UpdateBody) => void;
  onCancel: () => void;
  /** 更新请求进行中：确定按钮 loading 态 */
  confirming?: boolean;
  /** 推送被拒后的更新流程（GitRejectedPushUpdateDialog 语义）：标题与说明文案提示该场景 */
  pushRejected?: boolean;
  /** Reset to tracked（GitUpdateOptionsDialog 左下动作）：当前分支跟踪上游丢失时不能回退（该回调缺省时按钮禁用） */
  resetToTracked?: { localBranch: string; upstream: string };
  /** Reset to tracked 回调（确认前往上游硬重置）；缺省不渲染按钮（向后兼容） */
  onResetToTracked?: () => void;
  /** Reset 请求进行中：按钮 loading 态 */
  resetting?: boolean;
}

export function UpdateProjectDialog({
  open,
  onOk,
  onCancel,
  confirming,
  pushRejected,
  resetToTracked,
  onResetToTracked,
  resetting,
}: UpdateProjectDialogProps): React.ReactNode {
  const [strategy, setStrategy] = useState<'merge' | 'rebase'>('merge');

  /** 复位为默认策略：Modal 默认不卸载子树，取消/提交后重开不能残留上次选择 */
  const reset = (): void => {
    setStrategy('merge');
  };

  const close = (): void => {
    reset();
    onCancel();
  };

  /** 确定：契约 UpdateBody.strategy 必填，直接传出所选策略；回调后复位 */
  const submit = (): void => {
    onOk({ strategy });
    reset();
  };

  return (
    <Modal
      title={pushRejected ? '推送被拒 — 更新项目' : '更新项目'}
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          {pushRejected
            ? '远端有更新，请先拉取最新提交（更新完成后将自动重新推送）：'
            : '更新方式（fetch 全部远程后合入当前分支）：'}
        </Typography.Text>
        <Radio.Group
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as 'merge' | 'rebase')}
          options={[
            { value: 'merge', label: 'merge：合并（生成合并提交）' },
            { value: 'rebase', label: 'rebase：变基（线性历史）' },
          ]}
        />
        {onResetToTracked !== undefined && resetToTracked !== undefined && (
          <Flex gap={8} align="center" wrap="wrap" style={{ marginTop: 4 }}>
            <Button
              size="small"
              data-testid="reset-to-tracked"
              danger
              loading={resetting}
              onClick={onResetToTracked}
            >
              Reset to tracked：{resetToTracked.localBranch} → {resetToTracked.upstream}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              丢弃工作区/索引变更，回到上游分支状态
            </Typography.Text>
          </Flex>
        )}
      </Flex>
    </Modal>
  );
}
