/**
 * 设置页：应用设置（logInEditor 开关 + 界面主题 dark/light）+ 仓库 Git 配置（白名单键逐行：生效值展示 + local 覆盖输入 + 保存）+ GPG 提交签名（可选卡片）。
 *  账户卡片为可选第三张卡：仅在注入 accounts/回调时渲染（向后兼容）；token 本体不下行，仅展示掩码 tokenPreview。
 * 纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入 hooks。
 */
import { useState } from 'react';
import { Alert, Button, Card, Checkbox, Flex, Form, Input, Modal, Popconfirm, Segmented, Skeleton, Select, Switch, Tag, Tooltip, Typography } from 'antd';
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
import { PageShell } from '../base/page-shell';

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
      <Tooltip title={`填写 ${entry.key} 的仓库级（local）覆盖值：保存后写入本仓库 .git/config，仅对本仓库生效`}>
        <Input
          data-testid={`config-input-${entry.key}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: 1 }}
        />
      </Tooltip>
      {/* 禁用按钮不派发 hover，故在 Tooltip 与 Button 之间包一层 span 承接提示；文案随禁用原因切换 */}
      <Tooltip
        title={
          dirty
            ? '把输入值写入本仓库的 .git/config（仅覆盖当前仓库，不改全局配置）'
            : '输入值与生效值相同或为空：改动内容后才能保存'
        }
      >
        <span>
          <Button
            data-testid={`config-save-${entry.key}`}
            disabled={!dirty}
            onClick={() => onSetConfig(entry.key, value)}
          >
            保存
          </Button>
        </span>
      </Tooltip>
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
        {/* Tooltip 放最内层（Popconfirm > Tooltip > Button）：保持 Popconfirm 的触发链完整 */}
        <Tooltip title="删除该账户保存的本地凭据：只清本机记录，不影响远端服务器上的账号">
          <Button danger data-testid={`delete-account-${entry.host}-${entry.account}`}>
            删除
          </Button>
        </Tooltip>
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
        <Tooltip title="填写远程主机的域名（如 github.com）：与账户名一起定位一份凭据，三项任一为空都不能提交">
          <Input
            data-testid="account-host-input"
            placeholder="主机（如 github.com）"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </Tooltip>
        <Tooltip title="填写该主机上的账户名：认证时作为用户名，列表按 host + 账户名去重">
          <Input
            data-testid="account-name-input"
            placeholder="账户名"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </Tooltip>
        {/* 令牌只描述用途（下行仅给掩码预览），不编造任何示例内容 */}
        <Tooltip title="填写该账户的访问令牌（token）：保存到本地凭据库供该主机认证，列表里只显示掩码预览">
          <Input.Password
            data-testid="account-token-input"
            placeholder="访问令牌（token）"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </Tooltip>
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
        {/* 禁用控件（无可用密钥 / 未启用）不派发 hover：包 span 承接提示，文案说明为什么不能操作 */}
        <Tooltip
          title={
            noKeys
              ? '暂不能启用：系统里没有可用密钥（gpg --list-secret-keys 无结果），先创建密钥再回来'
              : '勾选后本仓库提交即用下方选定的密钥签名（写入 commit.gpgsign=true）'
          }
        >
          <span>
            <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={noKeys}>
              为仓库提交签名（commit.gpgsign）
            </Checkbox>
          </span>
        </Tooltip>
        <Tooltip
          title={
            noKeys
              ? '暂无可选项：先在本机创建 gpg 密钥（或配置 gpg.program 指向 gpg 程序）'
              : enabled
                ? '选择用于签名的私钥：提交时用它的 key id 签名（写入 user.signingkey）'
                : '先勾选上一项启用签名，再从密钥列表中选择'
          }
        >
          <span>
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
          </span>
        </Tooltip>
        {noKeys && (
          <Alert
            type="warning"
            showIcon
            data-testid="gpg-no-keys"
            title="未找到可用的 gpg 密钥"
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

/** 保护分支设置卡片（GitVcsPanel.protectedBranchesRow 语义）：每行一个正则模式；
 *  行内校验正则语法（非法标红禁止保存，对齐 Java Pattern.compile 校验）；保存经 onPatchSettings 补丁 */
function ProtectedBranchCard({
  patterns,
  onSave,
}: {
  patterns: string[];
  onSave: (patterns: string[]) => void;
}): React.ReactNode {
  const [text, setText] = useState(patterns.join('\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const invalid = lines.find((l) => {
    try {
      new RegExp(l);
      return false;
    } catch {
      return true;
    }
  });
  const dirty = text !== patterns.join('\n');
  return (
    <Card title="保护分支" data-testid="protected-branches-card">
      <Flex vertical gap={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          每行一个正则模式，匹配剥远程名前缀的分支名（origin/main → main）；匹配得到的远程分支上的已推送提交不可重写
          （Reword/Drop/Squash/Fixup 将被拒绝——GitProtectedBranches.isCommitPublishedBlocking 语义）
        </Typography.Text>
        <Tooltip title="填写保护分支的正则模式：每行一个，匹配到的远程分支上的已推送提交不允许被重写">
          <Input.TextArea
            data-testid="protected-patterns-input"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'每行一个模式，如：\n^main$\n^release/'}
          />
        </Tooltip>
        {invalid !== undefined && (
          <Typography.Text type="danger" data-testid="protected-patterns-error">
            非法正则：{invalid}
          </Typography.Text>
        )}
        <div>
          {/* 禁用按钮不派发 hover：包 span 承接提示；文案随禁用原因（非法正则 / 未改动）切换 */}
          <Tooltip
            title={
              invalid !== undefined
                ? `正则语法非法（${invalid}）：修正该行后才能保存`
                : dirty
                  ? '保存这份模式列表：写入应用设置，立即约束可改写的提交范围'
                  : '内容与已保存的模式相同：改动后才能保存'
            }
          >
            <span>
              <Button
                data-testid="protected-patterns-save"
                disabled={!dirty || invalid !== undefined}
                onClick={() => onSave(lines)}
              >
                保存
              </Button>
            </span>
          </Tooltip>
        </div>
      </Flex>
    </Card>
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
  // 页面根：横向沾满（原 maxWidth:720 人为收窄，移除）；gap/padding 照抄既有值。
  // 密度传 "default"：设置页按 spec D6 保持 antd 默认密度（其余页面由 PageShell 走紧凑密度）。
  return (
    <PageShell density="default" gap={16} padding={16}>
      <Card title="应用设置">
        {settings ? (
          /*
           * 应用设置两项均走 Form.Item 纵向布局：label 在上、控件在下（无表单字段语义，仅取其排版）。
           * component={false} 不落地 form 元素：内部只有受控控件，无原生提交语义。
           */
          <Form layout="vertical" component={false}>
            {/* 标签文案即原说明文字：Switch（无内联文本）由 label 承担可读名称 */}
            <Form.Item label="在编辑器中查看提交日志" style={{ marginBottom: 12 }}>
              <Tooltip title="切换提交日志的查看方式：开启后用本机编辑器打开，关闭则用内置页面查看（应用设置 logInEditor）">
                <Switch
                  checked={settings.logInEditor}
                  onChange={(checked) => onPatchSettings({ logInEditor: checked })}
                />
              </Tooltip>
            </Form.Item>
            {/* 界面主题：暗色/明亮二选一，写入应用设置后由 Providers 全站生效（含 Monaco 与 body 底色） */}
            <Form.Item label="界面主题" style={{ marginBottom: 0 }}>
              <Tooltip title="选择界面配色（暗色/明亮）：保存后全站立即生效，含编辑器与页面底色">
                <Segmented
                  data-testid="theme-segmented"
                  value={settings.theme}
                  options={[
                    { label: '暗色', value: 'dark' },
                    { label: '明亮', value: 'light' },
                  ]}
                  onChange={(value) => onPatchSettings({ theme: value as 'light' | 'dark' })}
                />
              </Tooltip>
            </Form.Item>
          </Form>
        ) : (
          <Skeleton active />
        )}
      </Card>
      {/* 保护分支（GitVcsPanel.protectedBranchesRow 语义）：模式列表 + 行内正则校验；仅在应用设置就绪后渲染 */}
      {settings !== undefined && (
        <ProtectedBranchCard
          patterns={settings.protectedBranchPatterns}
          onSave={(patterns) => onPatchSettings({ protectedBranchPatterns: patterns })}
        />
      )}
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
              title="未检测到可用的 git 可执行文件"
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
            <Tooltip title="打开 GPG 签名配置弹窗：开关提交签名并选择签名密钥">
              <Button data-testid="gpg-configure-button" onClick={() => setGpgOpen(true)}>
                配置…
              </Button>
            </Tooltip>
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
            <Tooltip title="打开添加账户弹窗：填写主机、账户名与访问令牌后保存到本地凭据">
              <Button type="primary" data-testid="add-account-button" onClick={() => setAddOpen(true)}>
                添加账户
              </Button>
            </Tooltip>
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
    </PageShell>
  );
}
