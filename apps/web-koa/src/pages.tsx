/**
 * 首页容器：useRecentRepos + useOpenRepo + useInitRepo + useCloneRepo + useRemoveRepo + useAppHomeDir
 * 注入 ui RepoPage（与 web-next 容器同构；导航用 react-router）。
 * 打开/初始化/克隆成功刷新列表并跳转日志页（失败 message.error），移除成功仅刷新列表。
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
import { useNavigate } from 'react-router-dom';
import { openRepoFlow, repoMutationFlow } from './open-repo-flow';

export function ReposPage(): React.ReactNode {
  const navigate = useNavigate();
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
          navigate: (repoId) => navigate(`/repos/${repoId}`),
        });
      }}
      onInit={(path) => {
        void repoMutationFlow(() => initRepo({ path }), () => mutate(), (repoId) => navigate(`/repos/${repoId}`), '初始化仓库失败');
      }}
      onClone={(url, targetDir) => {
        void repoMutationFlow(() => cloneRepo({ url, targetDir }), () => mutate(), (repoId) => navigate(`/repos/${repoId}`), '克隆仓库失败');
      }}
      onRemove={(repoId) => {
        void removeRepo(repoId)
          .then(() => mutate())
          .catch((err: unknown) => {
            // 移除失败以服务端中文 message 提示（成功路径由 mutate 刷新列表）
            void message.error(err instanceof Error ? err.message : '移除失败');
          });
      }}
    />
  );
}
