'use client';

/**
 * 工作树页容器：useWorktrees + 三 mutation（create/remove/prune，均同键回写）注入 ui WorktreePanel
 * （与 web-koa 容器同构；repoId 取 Next params、返回导航用 useRouter）。
 * WorktreePanel currentPath = repoPath（useRecentRepos 中该仓库的注册路径——与服务端 getRepoById 同源；
 * 「当前」标记为与列表主工作树 path 的字符串相等判定，8.3 短路径/斜杠形态差异可能使标记不命中——见任务报告）。
 * 按容器裁定：onRemove 单参不带 force（工作树有未合并变更时先处理，force 仅终端使用）。
 * 顶部返回按钮回日志页；「刷新」重取列表（mutate）；操作失败统一以服务端中文 message 提示。
 */
import { useCreateWorktree, usePruneWorktrees, useRecentRepos, useRemoveWorktree, useWorktrees } from '@rebased/client';
import { WorktreePanel } from '@rebased/ui';
import { Button, Flex, Tooltip, message } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: worktrees, error: worktreesError, mutate: mutateWorktrees } = useWorktrees(repoId);
  const { trigger: createWorktree, isMutating: creating } = useCreateWorktree(repoId);
  const { trigger: removeWorktree, isMutating: removing } = useRemoveWorktree(repoId);
  const { trigger: pruneWorktrees, isMutating: pruning } = usePruneWorktrees(repoId);
  // repoPath = 仓库注册路径（服务端 getRepoById 同源）：currentPath 与列表主工作树 path 字符串相等判定
  const { data: repos } = useRecentRepos();
  const repoPath = repos?.find((r) => r.id === repoId)?.path;
  const acting = creating || removing || pruning;
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection（既有容器做法）
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 页面级查询错误一次性呈现
  useEffect(() => {
    if (worktreesError !== undefined) void message.error(worktreesError instanceof Error ? worktreesError.message : String(worktreesError));
  }, [worktreesError]);
  // 列表未就绪前不渲染主体（加载态壳层后续任务再补；失败已 toast，面板不可用时静默）
  if (!worktrees) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <WorktreePanel
        key={repoId}
        worktrees={worktrees}
        currentPath={repoPath}
        onCreate={(body) => {
          createWorktree(body)
            .then(() => void message.success('工作树已创建'))
            .catch(onError);
        }}
        onRemove={(path, force) => {
          // force 缺省 false（安全默认）：工作树内有未提交改动时 git 拒绝移除，用户在行内确认框勾选「强制移除（--force）」后再删
          removeWorktree({ path, force: force === true })
            .then(() => void message.success('工作树已移除'))
            .catch(onError);
        }}
        onPrune={() => {
          pruneWorktrees()
            .then(() => void message.success('已清理失效工作树'))
            .catch(onError);
        }}
        acting={acting}
        onRefresh={() => void mutateWorktrees()}
      />
    </Flex>
  );
}
