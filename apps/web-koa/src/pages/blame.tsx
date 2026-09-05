/**
 * 溯源页容器：?file= 查询串（入口通道：未来从提交详情/文件列表带入）+ 页内文件路径输入 → useBlame → ui BlameView
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。
 * 查询串只作输入初始值，提交后不回写 URL（v1 简化）；file 为空串时 useBlame 挂 null key 不发请求。
 */
import { useBlame } from '@rebased/client';
import { BlameView, EmptyState } from '@rebased/ui';
import { Button, Flex, Input } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

export function RepoBlamePage(): React.ReactNode {
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
  const { data: lines, isLoading, error } = useBlame(repoId, file);
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
          data-testid="blame-file-input"
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
        <EmptyState title="输入文件路径开始溯源" description="溯源展示文件当前内容的逐行责任归属" />
      ) : (
        /* key=repoId：SPA 同挂载实例切换仓库时强制重挂载（面板无内部态，语义对齐分支页约定） */
        <BlameView
          key={repoId}
          file={file}
          lines={lines}
          loading={isLoading}
          error={error?.message}
          onOpenCommit={(hash) => navigate(`/repos/${repoId}?select=${hash}`)}
        />
      )}
    </Flex>
  );
}
