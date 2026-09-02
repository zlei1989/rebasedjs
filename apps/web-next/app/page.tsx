'use client';

/** 首页容器：useRecentRepos + useOpenRepo 注入 ui RepoPage；打开成功刷新列表并跳转日志页，失败经 message.error 反馈 */
import { useOpenRepo, useRecentRepos } from '@rebased/client';
import { RepoPage } from '@rebased/ui';
import { useRouter } from 'next/navigation';
import { openRepoFlow } from '../src/open-repo-flow';

export default function Page(): React.ReactNode {
  const router = useRouter();
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
          navigate: (repoId) => router.push(`/repos/${repoId}`),
        });
      }}
    />
  );
}
