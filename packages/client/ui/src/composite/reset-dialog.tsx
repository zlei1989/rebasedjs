/**
 * Reset 对话框（对照 Java GitNewResetDialog）：目标 ref 展示（只读文本，由调用方从选中提交带入）+
 *  mode 三选 Radio（soft「保留暂存区与工作区」/ mixed「保留工作区、重置暂存区（默认）」/ hard「丢弃暂存区与工作区全部改动」，默认 mixed），
 *  hard 二次确认（Modal 内 Checkbox「我了解 hard 将丢弃未提交改动」——勾选才放行确定按钮）。
 *  纯受控组件：open/ref 由父级持有，onOk 回调 {ref, mode}；mode/勾选为内部状态，关闭时复位。
 */
import { useState } from 'react';
import { Checkbox, Flex, Modal, Radio, Typography } from 'antd';
import type { ResetBody } from '@rebased/contracts';

export interface ResetDialogProps {
  open: boolean;
  /** 目标引用（提交哈希/分支/HEAD~n 表达式），透传进 onOk 的 ResetBody.ref */
  ref: string;
  /** 展示用文本（如短哈希+主题）；缺省展示 ref 原文 */
  refLabel?: string;
  onOk: (body: ResetBody) => void;
  onCancel: () => void;
  /** 重置请求进行中：确定按钮 loading 态 */
  confirming?: boolean;
}

/** Reset 模式：与契约 ResetBody.mode 一致 */
type ResetMode = ResetBody['mode'];

export function ResetDialog({ open, ref, refLabel, onOk, onCancel, confirming }: ResetDialogProps): React.ReactNode {
  const [mode, setMode] = useState<ResetMode>('mixed');
  const [hardAcked, setHardAcked] = useState(false);

  /** 关闭时复位 mode 与勾选：Modal 默认不卸载子树，取消后重开不能残留上次选择 */
  const close = (): void => {
    setMode('mixed');
    setHardAcked(false);
    onCancel();
  };

  /** 确定：传出 {ref, mode}；回调后同样复位内部状态（父级负责关窗） */
  const submit = (): void => {
    onOk({ ref, mode });
    setMode('mixed');
    setHardAcked(false);
  };

  /** hard 未勾选确认时禁用确定（二次确认门槛，防误丢工作区改动） */
  const hardBlocked = mode === 'hard' && !hardAcked;

  return (
    <Modal
      title="重置到"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: hardBlocked }}
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">目标：</Typography.Text>
          <Typography.Text code>{refLabel ?? ref}</Typography.Text>
        </Flex>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as ResetMode)}>
          <Flex vertical gap={4}>
            <Radio value="soft">soft：保留暂存区与工作区</Radio>
            <Radio value="mixed">mixed：保留工作区、重置暂存区（默认）</Radio>
            <Radio value="hard">hard：丢弃暂存区与工作区全部改动</Radio>
          </Flex>
        </Radio.Group>
        {/* hard 二次确认：仅 hard 模式渲染，勾选后才放行确定 */}
        {mode === 'hard' ? (
          <Checkbox checked={hardAcked} onChange={(e) => setHardAcked(e.target.checked)}>
            我了解 hard 将丢弃未提交改动
          </Checkbox>
        ) : null}
      </Flex>
    </Modal>
  );
}
