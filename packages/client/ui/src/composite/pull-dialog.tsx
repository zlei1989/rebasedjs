/**
 * Pull 对话框（对照 Java GitPullDialog 的精简面）：
 *  远程 Select（默认 origin/唯一远程；缺省由服务端取当前分支上游）+ rebase Checkbox（「使用 rebase 而非 merge」）。
 *  纯受控：open 由父级持有；远程/选项为内部状态，关闭时复位。
 */
import { useMemo, useState } from 'react';
import { Checkbox, Flex, Modal, Select, Typography } from 'antd';
import type { PullBody, RemoteList } from '@rebased/contracts';

export interface PullDialogProps {
  open: boolean;
  remotes: RemoteList;
  onOk: (b: PullBody) => void;
  onCancel: () => void;
  /** 拉取请求进行中：确定按钮 loading 态 */
  confirming?: boolean;
}

/** 默认远程：存在 origin 取 origin；否则唯一远程时取该远程；其余不预选（与 PushDialog 同一规则） */
function defaultRemoteName(remotes: RemoteList): string | undefined {
  if (remotes.remotes.some((r) => r.name === 'origin')) return 'origin';
  if (remotes.remotes.length === 1) return remotes.remotes[0].name;
  return undefined;
}

export function PullDialog({ open, remotes, onOk, onCancel, confirming }: PullDialogProps): React.ReactNode {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [rebase, setRebase] = useState(false);

  const options = useMemo(
    () => remotes.remotes.map((r) => ({ value: r.name, label: r.name })),
    [remotes],
  );

  /** 生效远程：用户未手动选择时落默认值（origin/唯一远程） */
  const effectiveRemote = selected ?? defaultRemoteName(remotes);

  /** 复位内部状态：Modal 默认不卸载子树，取消/提交后重开不能残留上次选择 */
  const reset = (): void => {
    setSelected(undefined);
    setRebase(false);
  };

  const close = (): void => {
    reset();
    onCancel();
  };

  /** 确定：仅非空/勾选时携带对应字段（契约 PullBody 各字段均 optional）；回调后复位内部状态 */
  const submit = (): void => {
    onOk({
      ...(effectiveRemote !== undefined ? { remote: effectiveRemote } : {}),
      ...(rebase ? { rebase: true } : {}),
    });
    reset();
  };

  return (
    <Modal
      title="拉取"
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">从远程拉取：</Typography.Text>
          <Select
            data-testid="pull-remote-select"
            style={{ flex: 1 }}
            placeholder="选择远程"
            value={effectiveRemote}
            options={options}
            onChange={setSelected}
          />
        </Flex>
        <Checkbox checked={rebase} onChange={(e) => setRebase(e.target.checked)}>
          使用 rebase 而非 merge
        </Checkbox>
      </Flex>
    </Modal>
  );
}
