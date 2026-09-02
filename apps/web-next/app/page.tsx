'use client';

/** 首页容器：useRecentRepos + useOpenRepo 注入 ui RepoPage；打开成功刷新列表并跳转日志页 */
import { useOpenRepo, useRecentRepos } from '@rebased/client';
import { RepoPage } from '@rebased/ui';
import { useRouter } from 'next/navigation';

export default function Page(): React.ReactNode {
  const router = useRouter();
  const { data: repos = [], mutate } = useRecentRepos();
  const { trigger: openRepo } = useOpenRepo();
  return (
    <RepoPage
      repos={repos}
      onOpen={(path) => {
        void (async () => {
          const { repoId } = await openRepo({ path });
          await mutate();
          router.push(`/repos/${repoId}`);
        })();
      }}
    />
  );
}
