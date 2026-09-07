/**
 * 文件历史页容器：?file= 查询串（入口通道）+ 页内文件路径输入 → useHistory → ui HistoryPanel
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate）。
 * 查询串只作输入初始值，提交后不回写 URL（v1 简化）；file 为空串时 useHistory 挂 null key 不发请求。
 * 条目点击（onSelectCommit）→ 跳日志页 ?select=<hash>（LogPage 以该参数初始化选中提交）。
 */
import { useHistory } from '@rebased/client';
import { EmptyState, HistoryPanel } from '@rebased/ui';
import { Button, Flex, Input } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

export function RepoHistoryPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFile = searchParams.get('file') ?? '';
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
    <Flex vertical align="flex-start" gap={8}>
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      <Flex gap={8}>
        <Input
          data-testid="history-file-input"
          placeholder="输入文件路径（相对仓库根目录，如 src/main.ts）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={submit}
        />
        <Button
          type="primary"
          autoInsertSpace={false}
          disabled={draft.trim() === ''}
          onClick={submit}
        >
          确定
        </Button>
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
          onSelectCommit={(hash) => navigate(`/repos/${repoId}?select=${hash}`)}
          onOpenDiff={(hash, parents) => {
            // 根提交（无父）→ root=1；其余 → from=父哈希、to=该提交
            if (parents.length === 0) {
              navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(file)}&root=1`);
            } else {
              navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(file)}&from=${parents[0]}&to=${hash}`);
            }
          }}
          onAnnotate={(hash) => navigate(`/repos/${repoId}/blame?file=${encodeURIComponent(file)}&rev=${hash}`)}
        />
      )}
    </Flex>
  );
}
