/** 首页容器：useRecentRepos + useOpenRepo 注入 ui RepoPage；打开成功刷新列表并跳转日志页（与 web-next 容器同构，导航用 react-router），失败经 message.error 反馈 */
import { useOpenRepo, useRecentRepos } from '@rebased/client';
import { RepoPage } from '@rebased/ui';
import { useNavigate } from 'react-router-dom';
import { openRepoFlow } from './open-repo-flow';

export function ReposPage(): React.ReactNode {
  const navigate = useNavigate();
  const { data: repos = [], mutate } = useRecentRepos();
  const { trigger: openRepo } = useOpenRepo();
  return (
    <RepoPage
      repos={repos}
      onOpen={(path) => {
        void openRepoFlow({
          path,
          openRepo,
          refresh: () => mutate(),
          navigate: (repoId) => navigate(`/repos/${repoId}`),
        });
      }}
    />
  );
}
