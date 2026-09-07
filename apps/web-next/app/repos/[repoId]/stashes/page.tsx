'use client';

/**
 * 贮藏页容器：useStashes + useStashAction + useStashUnstashAs + useStashDiff + useBranches 注入 ui StashPanel（与 web-koa 容器同构）；
 * 顶部返回按钮回日志页；操作失败经 message.error 呈现（成功响应由各 hook 显式回写缓存）；
 * Unstash As 会检出目标分支 → 成功后重验证 status 键（branch/headHash 变化）；
 * 本页自订阅 events：外部 CLI 保存/应用/弹出贮藏时工作区 entries 变化 → repo.state-changed → 重验证贮藏列表
 * （纯 drop/建删不改 RepoStatus 字段时 watcher 不产事件，见行内订阅注释）。
 */
import { useBranches, useStashAction, useStashDiff, useStashes, useStashUnstashAs, useRepoEvents } from '@rebased/client';
import { StashPanel } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { useSWRConfig } from 'swr';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: stashes, mutate: mutateStashes } = useStashes(repoId);
  const { trigger: stashAction, isMutating: acting } = useStashAction(repoId);
  // Unstash As：mutation 响应回写 stashes；成功后还需重验证 status（目标分支检出改变了 branch/HEAD）
  const { trigger: unstashAs, isMutating: unstashingAs } = useStashUnstashAs(repoId);
  const { mutate: mutateGlobal } = useSWRConfig();
  // 查看差异：行点击记录 diffIndex → 条件拉取（null 挂 null key）
  const [diffIndex, setDiffIndex] = useState<number | null>(null);
  const { data: stashDiff, isLoading: diffLoading, error: diffError } = useStashDiff(repoId, diffIndex);
  const { data: branches } = useBranches(repoId);
  // 外部 CLI 保存/应用/弹出贮藏 → 工作区 entries 变化 → repo.state-changed → 重验证贮藏列表；
  // 注：纯 git stash drop 不改 RepoStatus 字段，watcher 不产事件（watcher 架构的已知局限，已登记 P3 缺口），
  // 该场景依赖 SWR revalidate-on-mount/focus 兜底
  useRepoEvents(repoId, { onStatus: () => void mutateStashes() });
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 贮藏列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!stashes) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <StashPanel
        key={repoId}
        stashes={stashes}
        onAction={(action) => {
          stashAction(action).catch(onError);
        }}
        onUnstashAs={(index, branch) => {
          unstashAs({ index, branch })
            .then(() => {
              void message.success(`已检出 ${branch} 并应用贮藏`);
              // stash 键已由 hook 回写；status 键重取（目标分支检出）
              void mutateGlobal(`/api/repos/${repoId}/status`, undefined, { revalidate: true });
            })
            .catch(onError);
        }}
        unstashingAs={unstashingAs}
        branches={branches?.branches ?? []}
        stashDiff={stashDiff ?? null}
        diffLoading={diffLoading}
        diffError={diffError?.message ?? null}
        acting={acting}
      />
    </Flex>
  );
}
