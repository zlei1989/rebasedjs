/**
 * 设置页：应用设置（logInEditor 开关）+ 仓库 Git 配置（白名单键逐行：生效值展示 + local 覆盖输入 + 保存）。
 *  账户卡片为可选第三张卡：仅在注入 accounts/回调时渲染（向后兼容）；token 本体不下行，仅展示掩码 tokenPreview。
 * 纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入 hooks。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Modal, Popconfirm, Skeleton, Switch, Typography } from 'antd';
import type {
  AccountBody,
  AccountDeleteBody,
  AccountEntry,
  AccountList,
  ConfigKey,
  GitConfigEntry,
  GitConfigView,
  SettingsPatch,
  SettingsState,
} from '@rebased/contracts';

export interface SettingsPageProps {
  /** 应用设置；未就绪（undefined）时对应卡片显 Skeleton */
  settings?: SettingsState;
  /** 设置补丁回调（如 { logInEditor: false }） */
  onPatchSettings: (patch: SettingsPatch) => Promise<unknown> | void;
  /** 仓库 Git 配置视图；未就绪（undefined）时对应卡片显 Skeleton */
  config?: GitConfigView;
  /** 保存某配置键的仓库级（local）值 */
  onSetConfig: (key: ConfigKey, value: string) => Promise<unknown> | void;
  /** 账户掩码列表；缺省（undefined）时不渲染「账户」卡片（向后兼容） */
  accounts?: AccountList;
  /** 添加账户回调；添加成功/失败反馈由容器负责 */
  onAddAccount?: (body: AccountBody) => void;
  /** 删除账户回调 */
  onDeleteAccount?: (body: AccountDeleteBody) => void;
}

/** 单个配置键行：生效值副文本 + local 覆盖输入 + 保存（值非空且与 localValue 不同才可点） */
function ConfigRow({
  entry,
  onSetConfig,
}: {
  entry: GitConfigEntry;
  onSetConfig: (key: ConfigKey, value: string) => Promise<unknown> | void;
}): React.ReactNode {
  const [value, setValue] = useState(entry.localValue ?? '');
  const dirty = value !== '' && value !== (entry.localValue ?? '');
  return (
    <Flex align="center" gap={8}>
      <Flex vertical style={{ width: 200, flexShrink: 0 }}>
        <Typography.Text>{entry.key}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {entry.value ?? '未设置'}
        </Typography.Text>
      </Flex>
      <Input
        data-testid={`config-input-${entry.key}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: 1 }}
      />
      <Button
        data-testid={`config-save-${entry.key}`}
        size="small"
        disabled={!dirty}
        onClick={() => onSetConfig(entry.key, value)}
      >
        保存
      </Button>
    </Flex>
  );
}

/** 账户行：host + account + 掩码 tokenPreview + 删除（Popconfirm 确认后回调 {host, account}） */
function AccountRow({
  entry,
  onDeleteAccount,
}: {
  entry: AccountEntry;
  onDeleteAccount: (body: AccountDeleteBody) => void;
}): React.ReactNode {
  return (
    <Flex align="center" gap={8}>
      <Typography.Text style={{ width: 200, flexShrink: 0 }} ellipsis>
        {entry.host}
      </Typography.Text>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {entry.account}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {entry.tokenPreview}
      </Typography.Text>
      <Popconfirm
        title={`确定删除账户 ${entry.account}（${entry.host}）？`}
        okText="确定"
        cancelText="取消"
        onConfirm={() => onDeleteAccount({ host: entry.host, account: entry.account })}
      >
        <Button size="small" danger data-testid={`delete-account-${entry.host}-${entry.account}`}>
          删除
        </Button>
      </Popconfirm>
    </Flex>
  );
}

/** 添加账户 Modal：host + account + token（Input.Password）；三字段任一为空时确定禁用；关闭复位输入 */
function AddAccountModal({
  open,
  onAddAccount,
  onClose,
}: {
  open: boolean;
  onAddAccount: (body: AccountBody) => void;
  onClose: () => void;
}): React.ReactNode {
  const [host, setHost] = useState('');
  const [account, setAccount] = useState('');
  const [token, setToken] = useState('');

  /** 关闭时复位三个输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setHost('');
    setAccount('');
    setToken('');
    onClose();
  };

  /** 提交并复位：载荷 {host, account, token}；成功/失败反馈由容器负责 */
  const submit = (): void => {
    onAddAccount({ host: host.trim(), account: account.trim(), token: token.trim() });
    close();
  };

  const disabled = host.trim() === '' || account.trim() === '' || token.trim() === '';
  return (
    <Modal
      title="添加账户"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled, 'data-testid': 'add-account-submit' }}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={8}>
        <Input
          data-testid="account-host-input"
          placeholder="主机（如 github.com）"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <Input
          data-testid="account-name-input"
          placeholder="账户名"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
        />
        <Input.Password
          data-testid="account-token-input"
          placeholder="访问令牌（token）"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}

export function SettingsPage({ settings, onPatchSettings, config, onSetConfig, accounts, onAddAccount, onDeleteAccount }: SettingsPageProps): React.ReactNode {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <Flex vertical gap={16} style={{ padding: 16, maxWidth: 720 }}>
      <Card title="应用设置">
        {settings ? (
          <Flex align="center" gap={8}>
            <Switch
              checked={settings.logInEditor}
              onChange={(checked) => onPatchSettings({ logInEditor: checked })}
            />
            <Typography.Text>在编辑器中查看提交日志</Typography.Text>
          </Flex>
        ) : (
          <Skeleton active />
        )}
      </Card>
      <Card title="Git 配置（仓库级）">
        {config ? (
          <Flex vertical gap={8}>
            {config.entries.map((entry) => (
              <ConfigRow key={entry.key} entry={entry} onSetConfig={onSetConfig} />
            ))}
          </Flex>
        ) : (
          <Skeleton active />
        )}
      </Card>
      {/* 账户卡片：仅在 accounts 与两个回调齐备时渲染（旧容器缺省即不出现，向后兼容） */}
      {accounts && onAddAccount && onDeleteAccount && (
        <Card
          title="账户"
          extra={
            <Button size="small" type="primary" data-testid="add-account-button" onClick={() => setAddOpen(true)}>
              添加账户
            </Button>
          }
        >
          {accounts.accounts.length === 0 ? (
            <Typography.Text type="secondary">暂无账户</Typography.Text>
          ) : (
            <Flex vertical gap={8}>
              {accounts.accounts.map((entry) => (
                <AccountRow
                  key={`${entry.host}-${entry.account}`}
                  entry={entry}
                  onDeleteAccount={onDeleteAccount}
                />
              ))}
            </Flex>
          )}
        </Card>
      )}
      {onAddAccount && (
        <AddAccountModal open={addOpen} onAddAccount={onAddAccount} onClose={() => setAddOpen(false)} />
      )}
    </Flex>
  );
}
