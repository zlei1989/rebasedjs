'use client';

/**
 * 首页容器：useRecentRepos + useOpenRepo + useInitRepo + useCloneRepo + useRemoveRepo + useAppHomeDir
 * 注入 ui RepoPage；打开/初始化/克隆成功刷新列表并跳转日志页（失败 message.error），移除成功仅刷新列表。
 * 路径副文本 `~/` 相对化：homeDir 来自 GET /api/app/home-dir（浏览器端无法读 os.homedir，见 ui RepoPage）。
 */
import {
  useAppHomeDir,
  useCloneRepo,
  useInitRepo,
  useOpenRepo,
  useRecentRepos,
  useRemoveRepo,
} from '@rebased/client';
import { RepoPage } from '@rebased/ui';
import { message } from 'antd';
import { useRouter } from 'next/navigation';
import { openRepoFlow, repoMutationFlow } from '../src/open-repo-flow';

export default function Page(): React.ReactNode {
  const router = useRouter();
  const { data: repos = [], mutate } = useRecentRepos();
  const { trigger: openRepo } = useOpenRepo();
  const { trigger: initRepo, isMutating: initializing } = useInitRepo();
  const { trigger: cloneRepo, isMutating: cloning } = useCloneRepo();
  const { trigger: removeRepo } = useRemoveRepo();
  const { data: appInfo } = useAppHomeDir();
  return (
    <RepoPage
      repos={repos}
      homeDir={appInfo?.homeDir}
      cloning={cloning}
      initializing={initializing}
      onOpen={(path) => {
        void openRepoFlow({
          path,
          openRepo,
          refresh: () => mutate(),
          navigate: (repoId) => router.push(`/repos/${repoId}`),
        });
      }}
      onInit={(path) => {
        void repoMutationFlow(() => initRepo({ path }), () => mutate(), (repoId) => router.push(`/repos/${repoId}`), '初始化仓库失败');
      }}
      onClone={(url, targetDir) => {
        void repoMutationFlow(() => cloneRepo({ url, targetDir }), () => mutate(), (repoId) => router.push(`/repos/${repoId}`), '克隆仓库失败');
      }}
      onRemove={(repoId) => {
        void removeRepo(repoId)
          .then(() => mutate())
          .catch((err: unknown) => {
            // 移除失败以服务端中文 message 提示（成功路径由 mutate 刷新列表）
            void message.error(err instanceof Error ? err.message : '移除失败');
          });
      }}
      onOpenSettings={(repoId) => {
        // 欢迎屏 Configure → SettingsPage 入口（#3）：以最近仓库进入设置页（设置按仓库 git 配置呈现）
        router.push(`/repos/${repoId}/settings`);
      }}
    />
  );
}
