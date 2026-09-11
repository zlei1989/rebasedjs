/**
 * 合并对话框（对照 Java GitMergeDialog + GitOptionsPanel）：
 *  分支 Select（两组：本地分支（排除当前）/ 远程分支——`origin/*` 引用名直接作 merge 参数，服务端 git 解析远程跟踪引用）
 *  + 选项 Checkbox 组（no-ff「禁用快进」/squash「压缩为单提交」/no-commit「不自动提交」）+ 合并信息 Input（可选）。
 *  纯受控：open 由父级持有；分支/选项/信息为内部状态，关闭时复位。
 */
import { useMemo, useState } from 'react';
import { Checkbox, Flex, Input, Modal, Select, Tooltip, Typography } from 'antd';
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

  /** 可选分支：本地（排除当前——git merge 自身无意义）与远程两组；远程引用名（origin/xxx）直接可合并 */
  const options = useMemo(
    () => [
      {
        label: '本地分支',
        options: branches.branches
          .filter((b) => !b.remote && !b.current)
          .map((b) => ({ value: b.name, label: b.name })),
      },
      {
        label: '远程分支',
        options: branches.branches
          .filter((b) => b.remote)
          .map((b) => ({ value: b.name, label: b.name })),
      },
    ],
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
          <Tooltip title="合并来源分支：可选其他本地分支或远程跟踪分支（origin/* 直接作合并参数）">
            <Select
              data-testid="merge-branch-select"
              style={{ flex: 1 }}
              placeholder="选择分支"
              value={branch}
              options={options}
              onChange={setBranch}
            />
          </Tooltip>
        </Flex>
        <Flex vertical gap={4}>
          <Tooltip title="勾选后即使可快进也生成一个合并提交（保留「曾经合并过」的分支历史）">
            <Checkbox checked={noFf} onChange={(e) => setNoFf(e.target.checked)}>
              no-ff：禁用快进
            </Checkbox>
          </Tooltip>
          <Tooltip title="勾选后把合并进来的提交压成当前分支上的一个提交（改动停在暂存区，需再提交）">
            <Checkbox checked={squash} onChange={(e) => setSquash(e.target.checked)}>
              squash：压缩为单提交
            </Checkbox>
          </Tooltip>
          <Tooltip title="勾选后只把合并结果写进工作区与暂存区，不自动生成合并提交（需手动提交）">
            <Checkbox checked={noCommit} onChange={(e) => setNoCommit(e.target.checked)}>
              no-commit：不自动提交
            </Checkbox>
          </Tooltip>
        </Flex>
        <Tooltip title="合并提交信息：留空则用 git 默认的 merge 信息（仅在有合并提交时生效）">
          <Input
            data-testid="merge-message"
            placeholder="合并信息（可选）"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Tooltip>
      </Flex>
    </Modal>
  );
}
