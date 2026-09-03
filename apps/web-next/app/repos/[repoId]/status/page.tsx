'use client';

/**
 * 状态页容器：useRepoStatus + useStaging（文件级）+ useCommit + useDiffPatch（选中文件补丁预览）
 * 注入 ui StatusPage（与 web-koa 容器同构）。操作失败统一 message.error；
 * commit 成功后经 key remount 清空提交框并 mutate status（events 推送亦会覆盖）。
 */
import { useCommit, useDiffPatch, useRepoStatus, useStaging } from '@rebased/client';
import { StatusPage } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: status, mutate } = useRepoStatus(repoId);
  const { trigger: applyStaging } = useStaging(repoId);
  const { trigger: commit, isMutating: committing } = useCommit(repoId);
  // 选中文件态驱动行内补丁预览；null 时传空 file，useDiffPatch 内部 key 为 null 不发请求（条件拉取，hook 无条件挂载）
  const [patchSel, setPatchSel] = useState<{ path: string; staged: boolean } | null>(null);
  const { data: patch, isLoading: patchLoading } = useDiffPatch(repoId, patchSel?.path ?? '', patchSel?.staged ?? false);
  // 提交成功计数：并入 StatusPage key，commit 后 remount 清空提交框与勾选态（staging 回写由 hook 完成，无需 remount）
  const [commitSeq, setCommitSeq] = useState(0);
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 状态未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!status) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key 含 repoId（切仓库强制重挂载）与 commitSeq（commit 成功清空提交框） */}
      <StatusPage
        key={`${repoId}-${commitSeq}`}
        status={status}
        onStage={(paths) => void applyStaging({ action: 'stage', paths }).catch(onError)}
        onUnstage={(paths) => void applyStaging({ action: 'unstage', paths }).catch(onError)}
        onDiscard={(paths) => void applyStaging({ action: 'discard', paths }).catch(onError)}
        onCommit={(body) => {
          commit(body)
            .then(() => {
              setCommitSeq((n) => n + 1);
              void mutate();
            })
            .catch(onError);
        }}
        committing={committing}
        patch={patch}
        patchLoading={patchLoading}
        onSelectPatch={(path, staged) => setPatchSel({ path, staged })}
        // 跳既有 diff 页（仅带 file 参数；staged 切换在 diff 页内完成）
        onOpenDiff={(path) => router.push(`/repos/${repoId}/diff?file=${encodeURIComponent(path)}`)}
      />
    </Flex>
  );
}
