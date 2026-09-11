/**
 * Push 对话框（对照 Java GitPushDialog）：
 *  远程 Select（默认 origin/唯一远程）+ 分支文本输入（默认当前分支，可改推其他本地分支）+
 *  forceWithLease Checkbox（安全强推，danger 文案）+ setUpstream Checkbox（默认勾，首次推送场景）。
 *  upToHash 提供时进入「Push up to Commit」模式（GitPushUpToCommitAction 语义）：
 *  消息头展示目标提交、分支锁定当前分支、setUpstream 隐藏（-u 与哈希折返互斥）；载荷带 hash。
 *  纯受控：open 由父级持有；远程/分支/选项为内部状态，关闭时复位。
 */
import { useMemo, useState } from 'react';
import { Checkbox, Flex, Input, Modal, Select, Tag, Tooltip, Typography } from 'antd';
import type { PushBody, RemoteList } from '@rebased/contracts';

export interface PushDialogProps {
  open: boolean;
  remotes: RemoteList;
  currentBranch: string | null;
  onOk: (b: PushBody) => void;
  onCancel: () => void;
  /** 推送请求进行中：确定按钮 loading 态 */
  confirming?: boolean;
  /** Push up to Commit：非空时进入哈希模式（推送该提交到当前分支对应的远端分支） */
  upToHash?: string;
}

/** 默认远程：存在 origin 取 origin；否则唯一远程时取该远程；其余不预选 */
function defaultRemoteName(remotes: RemoteList): string | undefined {
  if (remotes.remotes.some((r) => r.name === 'origin')) return 'origin';
  if (remotes.remotes.length === 1) return remotes.remotes[0].name;
  return undefined;
}

export function PushDialog({ open, remotes, currentBranch, onOk, onCancel, confirming, upToHash }: PushDialogProps): React.ReactNode {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [branch, setBranch] = useState(currentBranch ?? '');
  const [forceWithLease, setForceWithLease] = useState(false);
  const [setUpstream, setSetUpstream] = useState(true);
  // Push up to Commit 模式：哈希锁定当前分支（Java：当前分支或首个包含该提交的本地分支——Web 取当前分支）
  const hashMode = upToHash !== undefined && upToHash !== '';

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
    onOk({
      ...(effectiveRemote !== undefined ? { remote: effectiveRemote } : {}),
      ...(hashMode ? { hash: upToHash } : { ...(branch.trim() === '' ? {} : { branch: branch.trim() }) }),
      ...(forceWithLease ? { forceWithLease: true } : {}),
      ...(!hashMode && setUpstream ? { setUpstream: true } : {}),
    });
    reset();
  };

  return (
    <Modal
      title={hashMode ? '推送（Push up to Commit）' : '推送'}
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        {hashMode ? (
          <Typography.Text type="secondary" data-testid="push-upto-hint">
            将把当前分支推到提交 <Tag style={{ marginInlineEnd: 0 }}>{upToHash.slice(0, 7)}</Tag>（须覆盖远端较新的提交时勾选 force-with-lease）
          </Typography.Text>
        ) : null}
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">推送到远程：</Typography.Text>
          <Tooltip title="推送到哪个远程：缺省按 origin 或唯一远程预选，手动改选会覆盖该默认值">
            <Select
              data-testid="push-remote-select"
              style={{ flex: 1 }}
              placeholder="选择远程"
              value={effectiveRemote}
              options={options}
              onChange={setSelected}
            />
          </Tooltip>
        </Flex>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">分支：</Typography.Text>
          {/* 哈希模式（Push up to Commit）下分支被锁定：禁用输入不派发 hover，在 Tooltip 与 Input 间包一层 span 承接提示；
              span 用 display:flex + flex:1 顶替原来「输入框撑满剩余宽度」的弹性行为，宽度与禁用前后保持一致 */}
          <Tooltip
            title={
              hashMode
                ? '分支已锁定为当前分支：该模式推的是上面这个提交，不能换分支名'
                : '要推送的本地分支名：默认当前分支，可改成其他本地分支（不填则推当前分支）'
            }
          >
            <span style={{ display: 'flex', flex: 1, minWidth: 0 }}>
              <Input
                data-testid="push-branch-input"
                placeholder="分支（默认当前分支）"
                value={hashMode ? (currentBranch ?? '') : branch}
                disabled={hashMode}
                onChange={(e) => setBranch(e.target.value)}
              />
            </span>
          </Tooltip>
        </Flex>
        <Flex vertical gap={4}>
          <Tooltip title="勾选后改用 force-with-lease：远端若已被他人更新则拒绝推送（比 --force 安全，不会静默覆盖）">
            <Checkbox checked={forceWithLease} onChange={(e) => setForceWithLease(e.target.checked)}>
              <Typography.Text type="danger">
                force-with-lease：安全强推（可能覆盖远程提交，慎用）
              </Typography.Text>
            </Checkbox>
          </Tooltip>
          {!hashMode ? (
            <Tooltip title="勾选后带 -u：把该远程分支设为当前分支的上游（首次推送新分支时建议勾选）">
              <Checkbox checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)}>
                set-upstream：设为上游（-u，首次推送时建议勾选）
              </Checkbox>
            </Tooltip>
          ) : null}
        </Flex>
      </Flex>
    </Modal>
  );
}
