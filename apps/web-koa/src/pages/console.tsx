/**
 * 控制台页容器：useConsole(repoId, 100) 注入 ui ConsolePanel（与 web-next 容器同构；
 * repoId 取 useParams、顶栏导航经 useRepoNav 装配，而非 Next params/router）。
 * 「刷新」按钮调 hook mutate 重取；loading 传 isLoading。
 * 记录内容为服务端 exec 环形缓冲（token 剥离后），本页只读。
 */
import { useConsole } from '@rebased/client';
import { ConsolePanel, PageShell, RepoTopNav } from '@rebased/ui';
import { useParams } from 'react-router-dom';
import { useRepoNav } from '../repo-nav';

export function RepoConsolePage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const nav = useRepoNav(repoId);
  // 固定取最近 100 条（服务端默认同样 100，显式传参保持语义自明）
  const { data: entries, isLoading, mutate } = useConsole(repoId, 100);
  return (
    <PageShell>
      {/* 仓库顶栏导航（共用组件）：current="console" 高亮「更多」按钮（控制台在更多菜单内） */}
      <RepoTopNav {...nav} current="console" />
      <ConsolePanel entries={entries} loading={isLoading} onRefresh={() => void mutate()} />
    </PageShell>
  );
}
