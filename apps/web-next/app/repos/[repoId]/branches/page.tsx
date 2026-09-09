'use client';

/**
 * 分支页容器：useBranches + useBranchAction + useCheckout 注入 ui BranchPanel（与 web-koa 容器同构）；
 * 顶部返回按钮回日志页；操作失败经 message.error 呈现（成功响应由各 hook 显式回写缓存）；
 * 本页自订阅 events：外部 CLI 检出/重命名当前分支时重验证分支列表刷新 current 标记
 * （纯建删非当前分支不改 RepoStatus 字段，watcher 不产事件，见行内订阅注释）。
 */
import { useBranchAction, useBranches, useBranchWorkingDiff, useCheckout, useCheckoutRebase, useCheckoutUpdate, useFetch, useForcePushedUpdate, useRepoEvents, useTags } from '@rebased/client';
import { BranchPanel } from '@rebased/ui';
import { Button, Flex, Modal, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: branches, mutate: mutateBranches } = useBranches(repoId);
  // 标签组（GitBranchesTreeSingleRepoModel tags 组语义）：分支面板底部「标签」卡片（行内检出 = detached）
  const { data: tags } = useTags(repoId);
  const { trigger: branchAction, isMutating: actingBranch } = useBranchAction(repoId);
  const { trigger: checkout, isMutating: checkingOut } = useCheckout(repoId);
  // 弹窗 Fetch（GitBranchPopupFetchAction 语义）：fetch 全部远程 → 成功后重验证分支列表（远程行/merged 态变化）
  const { trigger: fetch, isMutating: fetching } = useFetch(repoId);
  // force-push 后修复（GitForcePushedBranchUpdateAction 语义）：当前分支与上游分叉时行内入口——
  // fetch → 本地重置到上游 → 本地独有提交重放（冲突 → 冲突页）
  const { trigger: forcePushedUpdate, isMutating: fixingForcePushed } = useForcePushedUpdate(repoId);
  // 检出并变基到当前（GitCheckoutWithRebaseAction 语义）：目标分支检出后 rebase onto 当前分支；hook 成功后失效 status/branches 缓存
  const { trigger: checkoutRebase, isMutating: rebaseCheckingOut } = useCheckoutRebase(repoId);
  const onCheckoutRebase = (request: { branch: string; localName?: string }): void => {
    checkoutRebase(request)
      .then((outcome) => {
        if (outcome.status === 'conflicts') {
          void message.warning('检出并变基存在冲突，请在冲突页解决');
          router.push(`/repos/${repoId}/conflicts`);
          return;
        }
        void message.success(`已检出 ${request.branch} 并变基到当前分支`);
      })
      .catch(onError);
  };
  // 检出并更新（GitCheckoutWithUpdateAction 语义）：检出本地分支后 fetch 跟踪分支 + 策略化更新；hook 成功后失效双缓存键
  const { trigger: checkoutUpdate, isMutating: updatingCheckout } = useCheckoutUpdate(repoId);
  const onCheckoutUpdate = (request: { branch: string; strategy?: 'merge' | 'rebase' }): void => {
    checkoutUpdate(request)
      .then((outcome) => {
        if (outcome.status === 'conflicts') {
          void message.warning('检出并更新存在冲突，请在冲突页解决');
          router.push(`/repos/${repoId}/conflicts`);
          return;
        }
        void message.success(
          outcome.status === 'up-to-date'
            ? `已检出 ${request.branch}（已是最新）`
            : `已检出并更新 ${request.branch}`,
        );
      })
      .catch(onError);
  };
  // 与工作树差异（GitShowDiffWithRefAction 语义）：文件清单 Modal——行点击 → DiffPage（?file=&from=<branch>）
  const [workingDiffBranch, setWorkingDiffBranch] = useState('');
  const { data: workingDiffData, isLoading: workingDiffLoading, error: workingDiffError } = useBranchWorkingDiff(repoId, workingDiffBranch);
  const onForcePushedUpdate = (): void => {
    Modal.confirm({
      title: 'force-push 修复',
      content: '远端分支可能被强推（本地与上游分叉）。将拉取远端并把本地分支重置到上游，再把本地独有提交重放回来；冲突时可在冲突页解决。',
      okText: '确定',
      cancelText: '取消',
      onOk: () =>
        forcePushedUpdate()
          .then((outcome) => {
            if (outcome.status === 'conflicts') {
              void message.warning('重放存在冲突，请在冲突页解决');
              router.push(`/repos/${repoId}/conflicts`);
              return;
            }
            if (outcome.status === 'success') {
              void message.success(`已重置并重放 ${outcome.applied.length} 个本地提交`);
            } else {
              void message.success('已同步到上游（无本地独有提交）');
            }
            void mutateBranches();
          })
          .catch(onError),
    });
  };
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
        // 与当前分支比较（GitCompareWithBranchAction 语义 #10）：跳日志页 ?compare=<branch>（对比视图）
        onCompare={(branch) => router.push(`/repos/${repoId}?compare=${encodeURIComponent(branch)}`)}
        // 弹窗 Fetch（#67）：fetch 全部远程 → 重验证分支列表（远程行/merged 态随 refs 更新）
        onFetch={() => {
          fetch({})
            .then(() => {
              void message.success('已拉取远程引用');
              void mutateBranches();
            })
            .catch(onError);
        }}
        fetching={fetching}
        onForcePushedUpdate={onForcePushedUpdate}
        onCheckoutRebase={onCheckoutRebase}
        onCheckoutUpdate={onCheckoutUpdate}
        onShowDiffWithWorkingTree={setWorkingDiffBranch}
        workingDiffBranch={workingDiffBranch}
        workingDiffData={workingDiffData}
        workingDiffLoading={workingDiffLoading}
        workingDiffError={workingDiffError?.message}
        onCloseWorkingDiff={() => setWorkingDiffBranch('')}
        onOpenWorkingDiffFile={(branch, path) =>
          router.push(`/repos/${repoId}/diff?file=${encodeURIComponent(path)}&from=${encodeURIComponent(branch)}`)
        }
        tags={tags}
        acting={actingBranch || checkingOut || fixingForcePushed || rebaseCheckingOut || updatingCheckout}
      />
    </Flex>
  );
}
