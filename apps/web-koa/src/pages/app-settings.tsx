/**
 * 应用（全局）设置页容器（web-koa）：useSettings + 账户三 hooks + git 可执行文件检测注入 ui AppSettingsPage
 * （与 web-next 容器同构；导航用 useNavigate）。
 * 作用域：本页全部项与 repoId 无关（写入应用配置 ~/.rebasedjs/config.json），对所有仓库生效；
 * 仓库级项在 /repos/:repoId/settings（仓库设置页）。互跳到仓库设置取最近列表第一条，无仓库时该链接禁用。
 * 保存失败经 message.error，账户增删成功经 message.success。
 */
import { useAccounts, useDeleteAccount, useGitExecutableInfo, useRecentRepos, useSettings, useUpsertAccount } from '@rebased/client';
import { AppSettingsPage as AppSettingsPageView } from '@rebased/ui';
import { message } from 'antd';
import { useNavigate } from 'react-router-dom';

export function AppSettingsPage(): React.ReactNode {
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const { data: repos = [] } = useRecentRepos();
  // 账户为应用级资源（无 repoId）：列表查询 + 添加/覆盖、删除突变
  const { data: accounts } = useAccounts();
  const { trigger: upsertAccount } = useUpsertAccount();
  const { trigger: deleteAccount } = useDeleteAccount();
  // git 可执行文件检测（GitExecutableSelectorPanel 语义；应用级资源）
  const { data: gitExecutable } = useGitExecutableInfo();
  // 最近仓库（服务端按打开时间降序的第一条）：互跳仓库设置的落点
  const latestRepoId = repos[0]?.id;
  // 保存失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  return (
    <AppSettingsPageView
      settings={settings}
      onPatchSettings={(patch) => update(patch).catch(onError)}
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
      onBack={() => navigate('/')}
      otherSettingsDisabled={latestRepoId === undefined}
      onOpenOtherSettings={latestRepoId === undefined ? undefined : (): void => void navigate(`/repos/${latestRepoId}/settings`)}
    />
  );
}
