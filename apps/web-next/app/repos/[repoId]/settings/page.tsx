'use client';

/**
 * 设置页容器：useSettings + useRepoConfig + useSetConfig 注入 ui SettingsPage；
 * 顶部返回按钮回日志页；保存失败经 message.error 呈现（与 web-koa 容器同构）。
 */
import { useRepoConfig, useSetConfig, useSettings } from '@rebased/client';
import { SettingsPage } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { settings, update } = useSettings();
  const { data: config } = useRepoConfig(repoId);
  const { trigger } = useSetConfig(repoId);
  // 保存失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      <SettingsPage
        settings={settings}
        onPatchSettings={(patch) => update(patch).catch(onError)}
        config={config}
        onSetConfig={(key, value) => trigger({ key, value }).catch(onError)}
      />
    </Flex>
  );
}
