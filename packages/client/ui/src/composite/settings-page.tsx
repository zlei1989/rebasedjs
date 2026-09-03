/**
 * 设置页：应用设置（logInEditor 开关）+ 仓库 Git 配置（白名单键逐行：生效值展示 + local 覆盖输入 + 保存）。
 * 纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入 hooks。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Skeleton, Switch, Typography } from 'antd';
import type { ConfigKey, GitConfigEntry, GitConfigView, SettingsPatch, SettingsState } from '@rebased/contracts';

export interface SettingsPageProps {
  /** 应用设置；未就绪（undefined）时对应卡片显 Skeleton */
  settings?: SettingsState;
  /** 设置补丁回调（如 { logInEditor: false }） */
  onPatchSettings: (patch: SettingsPatch) => Promise<unknown> | void;
  /** 仓库 Git 配置视图；未就绪（undefined）时对应卡片显 Skeleton */
  config?: GitConfigView;
  /** 保存某配置键的仓库级（local）值 */
  onSetConfig: (key: ConfigKey, value: string) => Promise<unknown> | void;
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

export function SettingsPage({ settings, onPatchSettings, config, onSetConfig }: SettingsPageProps): React.ReactNode {
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
    </Flex>
  );
}
