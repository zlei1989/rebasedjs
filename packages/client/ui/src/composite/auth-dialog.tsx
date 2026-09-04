/**
 * 认证对话框（对照 Java GitHttpLoginDialog）：AUTH_FAILED 时弹出——
 *  host 只读展示 + account Input + token Input.Password + 确定（「保存并重试」，凭据任一为空时禁用）；
 *  取消即放弃操作。容器在 onOk 里保存账户后重试原操作一次（重试回路装配在页面容器，见 Task 8）。
 *  纯受控：open 由父级持有；account/token 为内部状态，关闭时清空（token 不残留）。
 */
import { useState } from 'react';
import { Flex, Input, Modal, Typography } from 'antd';

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
          {/* host 只读展示：认证目标由失败请求决定，不可在此修改 */}
          <Typography.Text data-testid="auth-host" strong>
            {host}
          </Typography.Text>
        </Flex>
        <Input
          data-testid="auth-account"
          placeholder="账户名"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        />
        <Input.Password
          data-testid="auth-token"
          placeholder="访问令牌（token）"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}
