/**
 * Reset 对话框（对照 Java GitNewResetDialog）：目标 ref 展示（只读文本，由调用方从选中提交带入）+
 *  mode 三选 Radio（soft「保留暂存区与工作区」/ mixed「保留工作区、重置暂存区（默认）」/ hard「丢弃暂存区与工作区全部改动」，默认 mixed），
 *  hard 二次确认（Modal 内 Checkbox「我了解 hard 将丢弃未提交改动」——勾选才放行确定按钮）。
 *  纯受控组件：open/ref 由父级持有，onOk 回调 {ref, mode}；mode/勾选为内部状态，关闭时复位。
 */
import { useState } from 'react';
import { Checkbox, Flex, Modal, Radio, Tooltip, Typography } from 'antd';
import type { ResetBody } from '@rebased/contracts';
import { EllipsisText } from '../base/ellipsis-text';

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
  /** 是否正悬停模式 Radio：Radio.Group 的 div 也监听 mouseenter（进组内任一 Radio 同样算进组），
   *  组 Tooltip 与 Radio 自身 Tooltip 会同时弹出——用它抑制组气泡，只留离鼠标最近的那一个 */
  const [radioHovering, setRadioHovering] = useState(false);

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
          {/* 目标 ref 是注入的不可断行长串（完整哈希 / 分支引用 / 「短哈希 + 主题」）；
              原标记已用 `code`，故 `mono` 只是把同一呈现交回 EllipsisText（Ruling P17(b)：
              仅原文即 code 的站点可用 `mono`，不引入额外观感）；转出后由本原语自带的
              `minWidth: 0` + `ellipsis` 承担窄屏截断（原写法在无 wrap 行内会顶宽弹窗），
              `title` 给完整值供 hover 查看 */}
          <EllipsisText mono title={refLabel ?? ref}>
            {refLabel ?? ref}
          </EllipsisText>
        </Flex>
        {/* open 受控：悬停组内 Radio 时抑制组气泡（Radio 自己会弹），否则两个气泡叠在一起 */}
        <Tooltip
          open={radioHovering ? false : undefined}
          title="重置模式：soft 只移动 HEAD；mixed 另重置暂存区；hard 连工作区改动一起丢弃——确定后不可撤销"
        >
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as ResetMode)}>
            <Flex vertical gap={4}>
              <Tooltip title="soft：HEAD 移到目标提交，暂存区与工作区的改动原样保留（可重新提交）">
                <Radio value="soft" onMouseEnter={() => setRadioHovering(true)} onMouseLeave={() => setRadioHovering(false)}>
                  soft：保留暂存区与工作区
                </Radio>
              </Tooltip>
              <Tooltip title="mixed：HEAD 移到目标提交并重置暂存区，工作区文件改动保留（git reset 默认行为）">
                <Radio value="mixed" onMouseEnter={() => setRadioHovering(true)} onMouseLeave={() => setRadioHovering(false)}>
                  mixed：保留工作区、重置暂存区（默认）
                </Radio>
              </Tooltip>
              <Tooltip title="hard：HEAD 移到目标提交并丢弃暂存区与工作区全部改动（未提交内容会永久丢失）">
                <Radio value="hard" onMouseEnter={() => setRadioHovering(true)} onMouseLeave={() => setRadioHovering(false)}>
                  hard：丢弃暂存区与工作区全部改动
                </Radio>
              </Tooltip>
            </Flex>
          </Radio.Group>
        </Tooltip>
        {/* hard 二次确认：仅 hard 模式渲染，勾选后才放行确定 */}
        {mode === 'hard' ? (
          <Tooltip title="确认已知 hard 的后果：勾选后确定按钮才放行（未提交改动将被丢弃）">
            <Checkbox checked={hardAcked} onChange={(e) => setHardAcked(e.target.checked)}>
              我了解 hard 将丢弃未提交改动
            </Checkbox>
          </Tooltip>
        ) : null}
      </Flex>
    </Modal>
  );
}
