/**
 * Push 对话框（对照 Java GitPushDialog）：
 *  远程 Select（默认 origin/唯一远程）+ 分支文本输入（默认当前分支，可改推其他本地分支）+
 *  forceWithLease Checkbox（安全强推，danger 文案）+ setUpstream Checkbox（默认勾，首次推送场景）。
 *  纯受控：open 由父级持有；远程/分支/选项为内部状态，关闭时复位。
 */
import { useMemo, useState } from 'react';
import { Checkbox, Flex, Input, Modal, Select, Typography } from 'antd';
import type { PushBody, RemoteList } from '@rebased/contracts';

export interface PushDialogProps {
  open: boolean;
  remotes: RemoteList;
  currentBranch: string | null;
  onOk: (b: PushBody) => void;
  onCancel: () => void;
  /** 推送请求进行中：确定按钮 loading 态 */
  confirming?: boolean;
}

/** 默认远程：存在 origin 取 origin；否则唯一远程时取该远程；其余不预选 */
function defaultRemoteName(remotes: RemoteList): string | undefined {
  if (remotes.remotes.some((r) => r.name === 'origin')) return 'origin';
  if (remotes.remotes.length === 1) return remotes.remotes[0].name;
  return undefined;
}

export function PushDialog({ open, remotes, currentBranch, onOk, onCancel, confirming }: PushDialogProps): React.ReactNode {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [branch, setBranch] = useState(currentBranch ?? '');
  const [forceWithLease, setForceWithLease] = useState(false);
  const [setUpstream, setSetUpstream] = useState(true);

  const options = useMemo(
    () => remotes.remotes.map((r) => ({ value: r.name, label: r.name })),
    [remotes],
  );

  /** 生效远程：用户未手动选择时落默认值（origin/唯一远程） */
  const effectiveRemote = selected ?? defaultRemoteName(remotes);

  /** 复位内部状态：Modal 默认不卸载子树，取消/提交后重开不能残留上次选择 */
  const reset = (): void => {
    setSelected(undefined);
    setBranch(currentBranch ?? '');
    setForceWithLease(false);
    setSetUpstream(true);
  };

  const close = (): void => {
    reset();
    onCancel();
  };

  /** 确定：仅非空/勾选时携带对应字段（契约 PushBody 各字段均 optional）；回调后复位内部状态 */
  const submit = (): void => {
    const trimmed = branch.trim();
    onOk({
      ...(effectiveRemote !== undefined ? { remote: effectiveRemote } : {}),
      ...(trimmed === '' ? {} : { branch: trimmed }),
      ...(forceWithLease ? { forceWithLease: true } : {}),
      ...(setUpstream ? { setUpstream: true } : {}),
    });
    reset();
  };

  return (
    <Modal
      title="推送"
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">推送到远程：</Typography.Text>
          <Select
            data-testid="push-remote-select"
            style={{ flex: 1 }}
            placeholder="选择远程"
            value={effectiveRemote}
            options={options}
            onChange={setSelected}
          />
        </Flex>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">分支：</Typography.Text>
          <Input
            data-testid="push-branch-input"
            placeholder="分支（默认当前分支）"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          />
        </Flex>
        <Flex vertical gap={4}>
          <Checkbox checked={forceWithLease} onChange={(e) => setForceWithLease(e.target.checked)}>
            <Typography.Text type="danger">
              force-with-lease：安全强推（可能覆盖远程提交，慎用）
            </Typography.Text>
          </Checkbox>
          <Checkbox checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)}>
            set-upstream：设为上游（-u，首次推送时建议勾选）
          </Checkbox>
        </Flex>
      </Flex>
    </Modal>
  );
}
