'use client';

/**
 * 控制台页容器：useConsole(repoId, 100) 注入 ui ConsolePanel（与 web-koa 容器同构）。
 * 顶部返回按钮回日志页；「刷新」按钮调 hook mutate 重取；loading 传 isLoading。
 * 记录内容为服务端 exec 环形缓冲（token 剥离后），本页只读。
 */
import { useConsole } from '@rebased/client';
import { ConsolePanel } from '@rebased/ui';
import { Button, Flex } from 'antd';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  // 固定取最近 100 条（服务端默认同样 100，显式传参保持语义自明）
  const { data: entries, isLoading, mutate } = useConsole(repoId, 100);
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      <ConsolePanel entries={entries} loading={isLoading} onRefresh={() => void mutate()} />
    </Flex>
  );
}
