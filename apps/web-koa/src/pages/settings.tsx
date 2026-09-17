/**
 * 仓库设置页容器（web-koa）：useRepoConfig + useSetConfig + GPG 签名配置两 hooks 注入 ui RepoSettingsPage
 * （与 web-next 容器同构；repoId 取 useParams、返回与互跳导航用 useNavigate）。
 * 作用域：本页只放**写入本仓库**的项（git 配置 local 9 键、GPG commit.gpgsign/user.signingkey）；
 * 应用级项在 /settings（应用设置页）。保存失败经 message.error，GPG 保存成功经 message.success。
 */
import { useGpgConfig, useRepoConfig, useSetConfig, useSetGpgConfig } from '@rebased/client';
import { RepoSettingsPage as RepoSettingsPageView, RepoTopNav } from '@rebased/ui';
import { message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useRepoNav } from '../repo-nav';

export function RepoSettingsPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const nav = useRepoNav(repoId);
  const { data: config } = useRepoConfig(repoId);
  const { trigger } = useSetConfig(repoId);
  // GPG 提交签名配置（GitGpgConfigDialog 语义；repo 级——commit.gpgsign/user.signingkey 写入仓库配置）
  const { data: gpgConfig } = useGpgConfig(repoId);
  const { trigger: setGpgConfig, isMutating: gpgSaving } = useSetGpgConfig(repoId);
  // 保存失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  return (
    <>
      {/* 仓库顶栏导航（共用组件）：current="settings" 高亮设置图标；「返回日志」由它承载（SettingsShell 只剩互跳） */}
      <RepoTopNav {...nav} current="settings" />
      <RepoSettingsPageView
        // key=repoId：SPA 同挂载实例切换仓库时强制重挂载，ConfigRow 行内输入 state 随之重置
        key={repoId}
        config={config}
        onSetConfig={(key, value) => trigger({ key, value }).catch(onError)}
        gpgConfig={gpgConfig}
        onSetGpgConfig={(body) =>
          setGpgConfig(body)
            .then(() => void message.success('GPG 签名配置已保存'))
            .catch(onError)
        }
        gpgSaving={gpgSaving}
        onOpenOtherSettings={() => navigate('/settings')}
      />
    </>
  );
}
