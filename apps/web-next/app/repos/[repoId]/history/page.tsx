'use client';

/**
 * 文件历史页容器：?file= 查询串（入口通道）+ 页内文件路径输入 → useHistory → ui HistoryPanel（与 web-koa 容器同构）。
 * 查询串只作输入初始值，提交后不回写 URL（v1 简化）；file 为空串时 useHistory 挂 null key 不发请求。
 * 条目点击（onSelectCommit）→ 跳日志页 ?select=<hash>（LogPage 以该参数初始化选中提交）；
 * 双击（onOpenDiff）→ /diff?file&from=parents[0]&to=hash（根提交 → root=1）；
 * Annotate Revision → /blame?file&rev=<hash>。
 */
import { useHistory } from '@rebased/client';
import { EmptyState, HistoryPanel, PageShell } from '@rebased/ui';
import { Button, Flex, Input, Tooltip } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ file?: string }>;
}): React.ReactNode {
  const { repoId } = use(params);
  const { file: initialFile = '' } = use(searchParams);
  const router = useRouter();
  const [file, setFile] = useState(initialFile);
  const [draft, setDraft] = useState(initialFile);
  // 仓库切换（两端 SPA 同挂载实例复用）或查询串变更时重置输入与查询（useState 初始化器只在首挂载生效）
  useEffect(() => {
    setFile(initialFile);
    setDraft(initialFile);
  }, [repoId, initialFile]);
  const { data: entries, isLoading, error } = useHistory(repoId, file);
  /** 提交输入：空白不触发（与 hook null-key 不发请求的语义一致） */
  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== '') setFile(trimmed);
  };
  return (
    <PageShell gap={8}>
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      <Flex gap={8}>
        <Tooltip title="输入文件路径（相对仓库根），回车列出该文件的提交历史">
          <Input
            data-testid="history-file-input"
            placeholder="输入文件路径（相对仓库根目录，如 src/main.ts）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={submit}
          />
        </Tooltip>
        {/* 禁用态 antd 按钮不派发 hover：按 antd 做法包一层 span 承接提示，文案点明不可点的前提 */}
        <Tooltip title="按输入的文件路径查询历史（重命名跟随，输入为空时此按钮不可点击）">
          <span>
            <Button
              type="primary"
              autoInsertSpace={false}
              disabled={draft.trim() === ''}
              onClick={submit}
            >
              确定
            </Button>
          </span>
        </Tooltip>
      </Flex>
      {file === '' ? (
        <EmptyState title="输入文件路径开始查看历史" description="历史包含重命名跟随（--follow），改名前的提交同样列出" />
      ) : (
        /* key=repoId：SPA 同挂载实例切换仓库时强制重挂载（语义对齐分支页约定） */
        <HistoryPanel
          key={repoId}
          file={file}
          entries={entries}
          loading={isLoading}
          error={error?.message}
          onSelectCommit={(hash) => router.push(`/repos/${repoId}?select=${hash}`)}
          onOpenDiff={(hash, parents) => {
            // 根提交（无父）→ root=1；其余 → from=父哈希、to=该提交
            if (parents.length === 0) {
              router.push(`/repos/${repoId}/diff?file=${encodeURIComponent(file)}&root=1`);
            } else {
              router.push(`/repos/${repoId}/diff?file=${encodeURIComponent(file)}&from=${parents[0]}&to=${hash}`);
            }
          }}
          onAnnotate={(hash) => router.push(`/repos/${repoId}/blame?file=${encodeURIComponent(file)}&rev=${hash}`)}
        />
      )}
    </PageShell>
  );
}
