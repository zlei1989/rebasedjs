/**
 * 认证对话框（对照 Java GitHttpLoginDialog）：AUTH_FAILED 时弹出——
 *  host 只读展示 + account Input + token Input.Password + 确定（「保存并重试」，凭据任一为空时禁用）；
 *  取消即放弃操作。容器在 onOk 里保存账户后重试原操作一次（重试回路装配在页面容器，见 Task 8）。
 *  纯受控：open 由父级持有；account/token 为内部状态，关闭时清空（token 不残留）。
 */
import { useState } from 'react';
import { Flex, Input, Modal, Tooltip, Typography } from 'antd';

export interface AuthDialogProps {
  open: boolean;
  host: string;
  onOk: (account: string, token: string) => void;
  onCancel: () => void;
  /** 保存/重试进行中：确定按钮 loading 态 */
  confirming?: boolean;
}

export function AuthDialog({ open, host, onOk, onCancel, confirming }: AuthDialogProps): React.ReactNode {
  const [account, setAccount] = useState('');
  const [token, setToken] = useState('');

  /** 关闭时清空凭据：Modal 默认不卸载子树，取消后重开不能残留上次输入（尤其 token） */
  const close = (): void => {
    setAccount('');
    setToken('');
    onCancel();
  };

  /** 确定：凭据去除首尾空白后传出（PAT 类 token 不含空白，粘贴常带换行）；回调后清空 */
  const submit = (): void => {
    onOk(account.trim(), token.trim());
    setAccount('');
    setToken('');
  };

  return (
    <Modal
      title="需要认证"
      open={open}
      okText="保存并重试"
      cancelText="取消"
      okButtonProps={{ disabled: account.trim() === '' || token.trim() === '' }}
      confirmLoading={confirming}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Flex align="center" gap={8}>
          <Typography.Text type="secondary">主机：</Typography.Text>
          {/* host 只读展示：认证目标由失败请求决定，不可在此修改。
              宽度：host 是注入的远端主机名（不可断行 ASCII，来源于失败请求的 err.context），
              同行「主机：」标签不可收缩：窄屏（360px 视口下 Modal 内容盒约 280px）下这一行会被 host 顶宽。
              此处是 EllipsisText 的**内联等价写法**而非换原语：本元素带 `data-testid`（被
              `auth-dialog.test.tsx:24` 断言）且 EllipsisText 不透传 testid；
              `ellipsis={{ tooltip }}` + `minWidth: 0` 与 EllipsisText 内部实现逐字同构
              （`ellipsis-text.tsx:45-54`），tooltip 仅在文本真的溢出时才出现，短主机名观感不变 */}
          <Typography.Text
            data-testid="auth-host"
            strong
            style={{ minWidth: 0 }}
            ellipsis={{ tooltip: host }}
          >
            {host}
          </Typography.Text>
        </Flex>
        {/* 两个输入各包一层 Tooltip：说明填什么（作用对象 + 用途），不与 placeholder 文案复述同一句话 */}
        <Tooltip title="填写该主机上的账户名：与下方令牌成对保存，作为访问远程仓库的用户名">
          <Input
            data-testid="auth-account"
            placeholder="账户名"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </Tooltip>
        {/* 密码框只描述用途：token 本体不下行、不回显，故不写任何示例内容 */}
        <Tooltip title="填写该账户的访问令牌（PAT）：仅用于本次主机认证，任一字段为空时「保存并重试」不可点">
          <Input.Password
            data-testid="auth-token"
            placeholder="访问令牌（token）"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Tooltip>
      </Flex>
    </Modal>
  );
}
