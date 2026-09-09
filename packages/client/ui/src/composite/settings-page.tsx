/**
 * 设置页：应用设置（logInEditor 开关）+ 仓库 Git 配置（白名单键逐行：生效值展示 + local 覆盖输入 + 保存）+ GPG 提交签名（可选卡片）。
 *  账户卡片为可选第三张卡：仅在注入 accounts/回调时渲染（向后兼容）；token 本体不下行，仅展示掩码 tokenPreview。
 * 纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入 hooks。
 */
import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Flex, Input, Modal, Popconfirm, Skeleton, Select, Switch, Tag, Typography } from 'antd';
import type {
  AccountBody,
  AccountDeleteBody,
  AccountEntry,
  AccountList,
  ConfigKey,
  GitConfigEntry,
  GitConfigView,
  GitExecutableInfo,
  GpgConfigBody,
  GpgConfigView,
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
  /** git 可执行文件信息（GitExecutableSelectorPanel 语义）：提供时渲染「Git 可执行文件」卡片（检测 + 版本 + 失败引导） */
  gitExecutable?: GitExecutableInfo;
  /** GPG 提交签名配置（GitGpgConfigDialog 语义）：提供时渲染「GPG 提交签名」卡片（启用态 + 选定密钥 + 可用密钥列表） */
  gpgConfig?: GpgConfigView;
  /** 保存 GPG 签名配置回调（{ enabled, key }；enabled=true 时 key 必选） */
  onSetGpgConfig?: (body: GpgConfigBody) => Promise<unknown> | void;
  /** GPG 保存请求进行中：Modal 确定 loading */
  gpgSaving?: boolean;
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

/** GPG 提交签名配置 Modal（GitGpgConfigDialog 语义）：checkbox 启用 + 密钥下拉（来自 gpg --list-secret-keys），
 *  确定回调 { enabled, key }（取消勾选 → key 为 null，服务端仅写 commit.gpgsign=false 不清 user.signingkey）。
 *  条件渲染（open 才挂载）保证每次打开从当前配置重置状态；无可用密钥时 Alert 提示且无法勾选启用 */
function GpgConfigModal({
  config,
  saving,
  onSetGpgConfig,
  onClose,
}: {
  config: GpgConfigView;
  saving?: boolean;
  onSetGpgConfig: (body: GpgConfigBody) => Promise<unknown> | void;
  onClose: () => void;
}): React.ReactNode {
  const [enabled, setEnabled] = useState(config.enabled);
  // 初始选中：当前 key 且仍在可用密钥列表中（保留外部配置值——列表可能不含它，仍允许显示）
  const [key, setKey] = useState<string | null>(config.key);
  const noKeys = config.keys.length === 0;
  const submit = (): void => {
    onSetGpgConfig({ enabled, key: enabled ? key : null });
    onClose();
  };
  return (
    <Modal
      title="GPG 提交签名配置"
      open
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: enabled && key === null, 'data-testid': 'gpg-config-submit' }}
      confirmLoading={saving}
      onOk={submit}
      onCancel={onClose}
    >
      <Flex vertical gap={12}>
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={noKeys}>
          为仓库提交签名（commit.gpgsign）
        </Checkbox>
        <Select
          data-testid="gpg-key-select"
          style={{ width: '100%' }}
          placeholder="选择签名密钥"
          disabled={!enabled || noKeys}
          value={key ?? undefined}
          onChange={(v: string) => setKey(v)}
          options={config.keys.map((k) => ({
            value: k.id,
            label: k.description === null ? k.id : `${k.id}（${k.description}）`,
          }))}
        />
        {noKeys && (
          <Alert
            type="warning"
            showIcon
            data-testid="gpg-no-keys"
            message="未找到可用的 gpg 密钥"
            description="gpg --list-secret-keys 无结果或 gpg 不可用；请先在系统配置签名密钥（gpg.program 可指定 gpg 程序路径）"
          />
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          配置与 git config 同步（commit.gpgsign / user.signingkey）
        </Typography.Text>
      </Flex>
    </Modal>
  );
}

export function SettingsPage({
  settings,
  onPatchSettings,
  config,
  onSetConfig,
  accounts,
  onAddAccount,
  onDeleteAccount,
  gitExecutable,
  gpgConfig,
  onSetGpgConfig,
  gpgSaving,
}: SettingsPageProps): React.ReactNode {
  const [addOpen, setAddOpen] = useState(false);
  const [gpgOpen, setGpgOpen] = useState(false);
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
      {/* git 可执行文件检测（GitExecutableSelectorPanel 语义）：检测 + 版本徽标；未检出 → 引导到 PATH 修复 */}
      {gitExecutable !== undefined ? (
        <Card title="Git 可执行文件" data-testid="git-executable-card">
          {gitExecutable.ok ? (
            <Flex align="center" gap={8}>
              <Tag color="green" data-testid="git-executable-ok">已检测</Tag>
              <Typography.Text type="secondary">{gitExecutable.exec}（PATH 查找）</Typography.Text>
              <Typography.Text code data-testid="git-executable-version">
                {gitExecutable.version ?? ''}
              </Typography.Text>
            </Flex>
          ) : (
            <Alert
              type="warning"
              showIcon
              data-testid="git-executable-error"
              message="未检测到可用的 git 可执行文件"
              description="请安装 Git 并确保 git 命令在服务进程的 PATH 环境中可执行（git --version 可正常运行）"
            />
          )}
        </Card>
      ) : null}
      {/* GPG 提交签名（GitGpgConfigDialog / GpgSignConfigurableRow 语义）：状态行 + 「配置…」→ 密钥 Modal */}
      {gpgConfig !== undefined && onSetGpgConfig !== undefined && (
        <Card
          title="GPG 提交签名"
          data-testid="gpg-card"
          extra={
            <Button size="small" data-testid="gpg-configure-button" onClick={() => setGpgOpen(true)}>
              配置…
            </Button>
          }
        >
          <Flex align="center" gap={8}>
            {gpgConfig.enabled ? (
              <>
                <Tag color="green" data-testid="gpg-enabled-tag">
                  已启用
                </Tag>
                <Typography.Text>{gpgConfig.key ?? '未配置签名密钥（commit.gpgsign=true）'}</Typography.Text>
                {gpgConfig.key !== null && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {gpgConfig.keys.find((k) => k.id === gpgConfig.key)?.description ?? ''}
                  </Typography.Text>
                )}
              </>
            ) : (
              <>
                <Tag data-testid="gpg-disabled-tag">未启用</Tag>
                <Typography.Text type="secondary">commit.gpgsign 为 false/未设置</Typography.Text>
              </>
            )}
          </Flex>
        </Card>
      )}
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
      {/* GPG 配置 Modal：条件渲染（开才挂载）→ 每次打开从当前配置重置 checkbox/密钥选择 */}
      {gpgOpen && gpgConfig !== undefined && onSetGpgConfig !== undefined && (
        <GpgConfigModal
          config={gpgConfig}
          saving={gpgSaving}
          onSetGpgConfig={onSetGpgConfig}
          onClose={() => setGpgOpen(false)}
        />
      )}
    </Flex>
  );
}
