/**
 * 状态页容器：useRepoStatus + useStaging（文件级）+ useCommit + useDiffPatch（选中文件补丁预览）
 * + useChangelists/useChangelistAction（变更列表分组与管理）。
 * 注入 ui StatusPage（与 web-next 容器同构；repoId 取 useParams、导航用 useNavigate，而非 Next params/router）。
 * 操作失败统一 message.error；commit 成功后经 key remount 清空提交框并 mutate status。
 * useRepoEvents 在本页自订阅（导航到 /status 后 LogPage 容器已卸载，外部 CLI 变更只能靠本订阅回写 status 缓存）。
 */
import { useChangelistAction, useChangelists, useCommit, useDiffPatch, useRepoEvents, useRepoStatus, useStaging } from '@rebased/client';
import type { StagingBody } from '@rebased/contracts';
import { StatusPage } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoStatusPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: status, mutate } = useRepoStatus(repoId);
  const { trigger: applyStaging } = useStaging(repoId);
  const { trigger: commit, isMutating: committing } = useCommit(repoId);
  // 变更列表：查询驱动 StatusPage 分组展示；action 响应由 hook 显式回写 changelists 缓存（约定同 staging）
  const { data: changelists, mutate: mutateChangelists } = useChangelists(repoId);
  const { trigger: applyChangelistAction } = useChangelistAction(repoId);
  // 选中文件态驱动行内补丁预览；null 时传空 file，useDiffPatch 内部 key 为 null 不发请求（条件拉取，hook 无条件挂载）
  const [patchSel, setPatchSel] = useState<{ path: string; staged: boolean } | null>(null);
  const {
    data: patch,
    isLoading: patchLoading,
    mutate: mutatePatch,
  } = useDiffPatch(repoId, patchSel?.path ?? '', patchSel?.staged ?? false);
  // 提交成功计数：并入 StatusPage key，commit 后 remount 清空提交框与勾选态（staging 回写由 hook 完成，无需 remount）
  const [commitSeq, setCommitSeq] = useState(0);
  // 状态推送（外部 CLI 变更/后台操作完成）：server-authoritative 回写 status 缓存；
  // revalidate:false 与 staging hook 回写约定一致，避免 GET 竞态覆盖。
  // watcher 仅轮询 status/operation：只有 RepoStatus 字段变化才产 repo.state-changed，
  // changelist 簿记（assignments）自身变化不产事件；但 status 变化可能伴随 assignments 修剪，
  // 故同一事件顺带重校验 changelists 缓存（簿记单变的刷新缺口由 SWR focus 重校验兜底）
  useRepoEvents(repoId, {
    onStatus: (next) => {
      void mutate(next, { revalidate: false });
      void mutateChangelists();
    },
  });
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // staging/commit 改变文件 diff：当前选中文件的 diff/patch 缓存失效重取（patchSel 为空时无 key 可失效，跳过）
  const invalidatePatch = (): void => {
    if (patchSel) void mutatePatch();
  };
  const onStaging = (body: StagingBody): void => {
    applyStaging(body).then(invalidatePatch).catch(onError);
  };
  // 状态未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!status) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key 含 repoId（切仓库强制重挂载）与 commitSeq（commit 成功清空提交框） */}
      <StatusPage
        key={`${repoId}-${commitSeq}`}
        status={status}
        onStage={(paths) => onStaging({ action: 'stage', paths })}
        onUnstage={(paths) => onStaging({ action: 'unstage', paths })}
        onDiscard={(paths) => onStaging({ action: 'discard', paths })}
        onCommit={(body) => {
          commit(body)
            .then(() => {
              setCommitSeq((n) => n + 1);
              void mutate();
              invalidatePatch();
            })
            .catch(onError);
        }}
        committing={committing}
        changelists={changelists}
        // 变更列表操作失败同样走统一 message.error
        onChangelistAction={(action) => {
          applyChangelistAction(action).catch(onError);
        }}
        patch={patch}
        patchLoading={patchLoading}
        onSelectPatch={(path, staged) => setPatchSel({ path, staged })}
        // 跳既有 diff 页（仅带 file 参数；staged 切换在 diff 页内完成）
        onOpenDiff={(path) => navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(path)}`)}
      />
    </Flex>
  );
}
