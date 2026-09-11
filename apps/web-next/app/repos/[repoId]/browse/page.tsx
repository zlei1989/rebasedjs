'use client';

/**
 * 历史快照浏览页容器：?rev= 查询串（入口通道，来自 LogPage「浏览快照」）+ 页内 ref 输入
 * → useBrowseTree（文件树）+ useBrowseContent（选中文件内容）→ ui BrowsePanel（与 web-koa 容器同构）。
 * 查询串只作输入初始值，提交后不回写 URL（v1 简化，与 history 页约定一致）；
 * rev 为空串时 useBrowseTree 挂 null key 不发请求。
 * 选中文件（onSelectFile）仅驱动内容视图（v1 不做 DiffPage from/to 联动，readFileAtRev 复用面见 browse 服务）。
 */
import { useBrowseContent, useBrowseTree } from '@rebased/client';
import { BrowsePanel, EmptyState, PageShell } from '@rebased/ui';
import { Button, Flex, Input, Tooltip } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ rev?: string }>;
}): React.ReactNode {
  const { repoId } = use(params);
  const { rev: initialRev = '' } = use(searchParams);
  const router = useRouter();
  const [rev, setRev] = useState(initialRev);
  const [draft, setDraft] = useState(initialRev);
  // 选中的文件路径（仅内容视图驱动；rev 变化时复位）
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  // 仓库切换（两端 SPA 同挂载实例复用）或查询串变更时重置输入与查询（useState 初始化器只在首挂载生效）
  useEffect(() => {
    setRev(initialRev);
    setDraft(initialRev);
    setSelectedPath(undefined);
  }, [repoId, initialRev]);
  const { data: tree, isLoading, error } = useBrowseTree(repoId, rev);
  const { data: content, isLoading: contentLoading, error: contentError } = useBrowseContent(repoId, rev, selectedPath ?? '');
  /** 提交输入：空白不触发（与 hook null-key 不发请求的语义一致） */
  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== '') {
      setRev(trimmed);
      setSelectedPath(undefined);
    }
  };
  return (
    <PageShell gap={8}>
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      {/* alignSelf: PageShell 刻意不设 alignItems，直接子项会被拉成整行宽、文字居中；就地收回内容宽（保持紧凑左对齐链接观感，原语契约不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button style={{ alignSelf: 'flex-start' }} type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      <Flex gap={8}>
        <Tooltip title="输入提交哈希、分支或标签，回车浏览该版本的文件树">
          <Input
            data-testid="browse-rev-input"
            placeholder="输入提交哈希/分支/标签（如 HEAD 或 6f4a2c1）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={submit}
          />
        </Tooltip>
        {/* 禁用态 antd 按钮不派发 hover：按 antd 做法包一层 span 承接提示，文案点明不可点的前提 */}
        <Tooltip title="按输入的 ref 只读浏览该版本快照（输入为空时此按钮不可点击）">
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
      {rev === '' ? (
        <EmptyState title="输入 ref 开始浏览快照" description="以该提交为根只读浏览文件树，不触碰工作区" />
      ) : (
        /* key=repoId+rev：SPA 同挂载实例切换仓库/版本时强制重挂载（树初始展开态与复用语义对齐分支页约定） */
        <BrowsePanel
          key={`${repoId}-${rev}`}
          rev={rev}
          entries={tree?.entries}
          loading={isLoading}
          error={error?.message}
          selectedPath={selectedPath}
          content={content}
          contentLoading={contentLoading}
          contentError={contentError?.message}
          onSelectFile={setSelectedPath}
        />
      )}
    </PageShell>
  );
}
