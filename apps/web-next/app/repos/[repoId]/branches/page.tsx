'use client';

/**
 * 分支页容器：useBranches + useBranchAction + useCheckout 注入 ui BranchPanel（与 web-koa 容器同构）；
 * 顶部返回按钮回日志页；操作失败经 message.error 呈现（成功响应由各 hook 显式回写缓存，
 * checkout 后 headHash 变化经日志页 events 推送自动刷新，无需额外接线）。
 */
import { useBranchAction, useBranches, useCheckout } from '@rebased/client';
import { BranchPanel } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: branches, mutate: mutateBranches } = useBranches(repoId);
  const { trigger: branchAction, isMutating: actingBranch } = useBranchAction(repoId);
  const { trigger: checkout, isMutating: checkingOut } = useCheckout(repoId);
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 分支列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!branches) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <BranchPanel
        key={repoId}
        branches={branches}
        onAction={(action) => {
          branchAction(action).catch(onError);
        }}
        onCheckout={(action) => {
          // checkout 响应只回写 status 缓存；分支列表的 current 标记随之变化，成功后重验证 branches
          checkout(action)
            .then(() => mutateBranches())
            .catch(onError);
        }}
        acting={actingBranch || checkingOut}
      />
    </Flex>
  );
}
