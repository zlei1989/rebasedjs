/**
 * 控制台页容器：useConsole(repoId, 100) 注入 ui ConsolePanel（与 web-next 容器同构；
 * repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。
 * 「刷新」按钮调 hook mutate 重取；loading 传 isLoading。
 * 记录内容为服务端 exec 环形缓冲（token 剥离后），本页只读。
 */
import { useConsole } from '@rebased/client';
import { ConsolePanel } from '@rebased/ui';
import { Button, Flex } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoConsolePage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  // 固定取最近 100 条（服务端默认同样 100，显式传参保持语义自明）
  const { data: entries, isLoading, mutate } = useConsole(repoId, 100);
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      <ConsolePanel entries={entries} loading={isLoading} onRefresh={() => void mutate()} />
    </Flex>
  );
}
