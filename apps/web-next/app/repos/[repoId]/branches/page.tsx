'use client';

/**
 * 分支页容器：useBranches + useBranchAction + useCheckout 注入 ui BranchPanel（与 web-koa 容器同构）；
 * 顶部返回按钮回日志页；操作失败经 message.error 呈现（成功响应由各 hook 显式回写缓存）；
 * 本页自订阅 events：外部 CLI 检出/重命名当前分支时重验证分支列表刷新 current 标记
 * （纯建删非当前分支不改 RepoStatus 字段，watcher 不产事件，见行内订阅注释）。
 */
import { useBranchAction, useBranches, useCheckout, useRepoEvents } from '@rebased/client';
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
  // 外部 CLI 检出/重命名当前分支 → repo.state-changed（branch/headHash 变化）→ 重验证分支列表刷新 current 标记；
  // 注：纯建删非当前分支不改 RepoStatus 字段，watcher 不产事件（watcher 架构的已知局限，已登记 P3 缺口）
  useRepoEvents(repoId, { onStatus: () => void mutateBranches() });
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
        onCleanupMerged={() => {
          // 清理已合并到 HEAD 的本地非当前分支：逐条走既有 delete（已合并无需 force），全部完成后重验证列表
          const targets = branches.branches.filter((b) => !b.remote && b.mergedIntoHead && !b.current);
          void (async () => {
            for (const branch of targets) {
              await branchAction({ action: 'delete', name: branch.name });
            }
            void mutateBranches();
            void message.success(`已清理 ${targets.length} 个已合并分支`);
          })().catch(onError);
        }}
        acting={actingBranch || checkingOut}
      />
    </Flex>
  );
}
