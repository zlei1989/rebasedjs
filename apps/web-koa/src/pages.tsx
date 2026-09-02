/** 首页容器：useRecentRepos + useOpenRepo 注入 ui RepoPage；打开成功刷新列表并跳转日志页（与 web-next 容器同构，导航用 react-router） */
import { useOpenRepo, useRecentRepos } from '@rebased/client';
import { RepoPage } from '@rebased/ui';
import { useNavigate } from 'react-router-dom';

export function ReposPage(): React.ReactNode {
  const navigate = useNavigate();
  const { data: repos = [], mutate } = useRecentRepos();
  const { trigger: openRepo } = useOpenRepo();
  return (
    <RepoPage
      repos={repos}
      onOpen={(path) => {
        void (async () => {
          const { repoId } = await openRepo({ path });
          await mutate();
          navigate(`/repos/${repoId}`);
        })();
      }}
    />
  );
}
