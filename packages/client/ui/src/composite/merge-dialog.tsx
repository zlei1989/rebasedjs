/**
 * 合并对话框（对照 Java GitMergeDialog + GitOptionsPanel）：
 *  分支 Select（本地分支，排除当前分支）+ 选项 Checkbox 组（no-ff「禁用快进」/squash「压缩为单提交」/
 *  no-commit「不自动提交」）+ 合并信息 Input（可选）。
 *  纯受控：open 由父级持有；分支/选项/信息为内部状态，关闭时复位。
 */
import { useMemo, useState } from 'react';
import { Checkbox, Flex, Input, Modal, Select, Typography } from 'antd';
import type { BranchList, MergeBody } from '@rebased/contracts';

export interface MergeDialogProps {
  open: boolean;
  branches: BranchList;
  onOk: (body: MergeBody) => void;
  onCancel: () => void;
  /** 合并请求进行中：确定按钮 loading 态 */
  confirming?: boolean;
}

export function MergeDialog({ open, branches, onOk, onCancel, confirming }: MergeDialogProps): React.ReactNode {
  const [branch, setBranch] = useState<string | undefined>(undefined);
  const [noFf, setNoFf] = useState(false);
  const [squash, setSquash] = useState(false);
  const [noCommit, setNoCommit] = useState(false);
  const [message, setMessage] = useState('');

  /** 可选分支：仅本地且排除当前分支（git merge 自身无意义）；远程分支 v1 不支持直接合并 */
  const options = useMemo(
    () =>
      branches.branches
        .filter((b) => !b.remote && !b.current)
        .map((b) => ({ value: b.name, label: b.name })),
    [branches],
  );

  /** 关闭时复位全部内部状态：Modal 默认不卸载子树，取消后重开不能残留上次选择 */
  const close = (): void => {
    setBranch(undefined);
    setNoFf(false);
    setSquash(false);
    setNoCommit(false);
    setMessage('');
    onCancel();
  };

  /** 确定：仅勾选/填写非空时携带对应字段（契约 MergeBody 各选项均 optional）；回调后复位内部状态 */
  const submit = (): void => {
    if (branch === undefined) return;
    const trimmed = message.trim();
    onOk({
      branch,
      ...(noFf ? { noFf: true } : {}),
      ...(squash ? { squash: true } : {}),
      ...(noCommit ? { noCommit: true } : {}),
      ...(trimmed === '' ? {} : { message: trimmed }),
    });
    setBranch(undefined);
    setNoFf(false);
    setSquash(false);
    setNoCommit(false);
    setMessage('');
  };

  return (
    <Modal
      title="合并分支"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: branch === undefined }}
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">合并到当前分支：</Typography.Text>
          <Select
            data-testid="merge-branch-select"
            style={{ flex: 1 }}
            placeholder="选择分支"
            value={branch}
            options={options}
            onChange={setBranch}
          />
        </Flex>
        <Flex vertical gap={4}>
          <Checkbox checked={noFf} onChange={(e) => setNoFf(e.target.checked)}>
            no-ff：禁用快进
          </Checkbox>
          <Checkbox checked={squash} onChange={(e) => setSquash(e.target.checked)}>
            squash：压缩为单提交
          </Checkbox>
          <Checkbox checked={noCommit} onChange={(e) => setNoCommit(e.target.checked)}>
            no-commit：不自动提交
          </Checkbox>
        </Flex>
        <Input
          data-testid="merge-message"
          placeholder="合并信息（可选）"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}
