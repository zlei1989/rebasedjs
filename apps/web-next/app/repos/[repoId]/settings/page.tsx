'use client';

/**
 * 设置页容器：useSettings + useRepoConfig + useSetConfig + GPG 签名配置两 hooks + 账户三 hooks 注入 ui SettingsPage；
 * 顶部返回按钮回日志页；保存失败经 message.error 呈现，账户增删/GPG 保存成功经 message.success 反馈（与 web-koa 容器同构）。
 */
import { useAccounts, useDeleteAccount, useGitExecutableInfo, useGpgConfig, useRepoConfig, useSetConfig, useSetGpgConfig, useSettings, useUpsertAccount } from '@rebased/client';
import { SettingsPage } from '@rebased/ui';
import { Button, Flex, Tooltip, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { settings, update } = useSettings();
  const { data: config } = useRepoConfig(repoId);
  const { trigger } = useSetConfig(repoId);
  // 账户为应用级资源（无 repoId）：列表查询 + 添加/覆盖、删除突变
  const { data: accounts } = useAccounts();
  const { trigger: upsertAccount } = useUpsertAccount();
  const { trigger: deleteAccount } = useDeleteAccount();
  // git 可执行文件检测（GitExecutableSelectorPanel 语义；应用级资源）
  const { data: gitExecutable } = useGitExecutableInfo();
  // GPG 提交签名配置（GitGpgConfigDialog 语义；repo 级——commit.gpgsign/user.signingkey 写入仓库配置）
  const { data: gpgConfig } = useGpgConfig(repoId);
  const { trigger: setGpgConfig, isMutating: gpgSaving } = useSetGpgConfig(repoId);
  // 保存失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，ConfigRow 行内输入 state 随之重置 */}
      <SettingsPage
        key={repoId}
        settings={settings}
        onPatchSettings={(patch) => update(patch).catch(onError)}
        config={config}
        onSetConfig={(key, value) => trigger({ key, value }).catch(onError)}
        accounts={accounts}
        onAddAccount={(body) =>
          upsertAccount(body)
            .then(() => void message.success('账户已保存'))
            .catch(onError)
        }
        onDeleteAccount={(body) =>
          deleteAccount(body)
            .then(() => void message.success('账户已删除'))
            .catch(onError)
        }
        gitExecutable={gitExecutable}
        gpgConfig={gpgConfig}
        onSetGpgConfig={(body) =>
          setGpgConfig(body)
            .then(() => void message.success('GPG 签名配置已保存'))
            .catch(onError)
        }
        gpgSaving={gpgSaving}
      />
    </Flex>
  );
}
