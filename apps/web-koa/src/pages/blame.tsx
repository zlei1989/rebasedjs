/**
 * 溯源页容器：?file=[&rev=] 查询串（入口通道：历史页「Annotate Revision」带 rev）+ 页内文件路径输入
 * → useBlame → ui BlameView（与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。
 * 查询串只作输入初始值，提交后不回写 URL（v1 简化，页内状态即来源）；
 * file 为空串时 useBlame 挂 null key 不发请求，页面渲染空态引导。
 * 行内联动：差异 → /diff?file&from=parents[0]&to=hash（根提交 → root=1）；历史 → /history?file；
 * 受影响（Show All Affected #34）→ useCommitFiles 条件拉取该提交全量变更文件 Modal（文件点击 → 该文件 diff）。
 */
import { useBlame, useCommitFiles } from '@rebased/client';
import { BlameView, EmptyState } from '@rebased/ui';
import { Button, Flex, Input } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

export function RepoBlamePage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFile = searchParams.get('file') ?? '';
  const initialRev = searchParams.get('rev') ?? '';
  const [file, setFile] = useState(initialFile);
  const [draft, setDraft] = useState(initialFile);
  const [rev, setRev] = useState(initialRev);
  // 仓库切换（两端 SPA 同挂载实例复用）或查询串变更时重置输入与查询（useState 初始化器只在首挂载生效）
  useEffect(() => {
    setFile(initialFile);
    setDraft(initialFile);
    setRev(initialRev);
  }, [repoId, initialFile, initialRev]);
  const { data: lines, isLoading, error } = useBlame(repoId, file, rev);
  // 受影响文件 Modal（Show All Affected #34）：affectedHash 非空 → 条件拉取该提交全量变更文件；空串挂 null key 不发请求
  const [affectedHash, setAffectedHash] = useState('');
  const { data: affectedEntry, isLoading: affectedLoading, error: affectedError } = useCommitFiles(repoId, affectedHash);
  /** 提交输入：空白不触发（与 hook null-key 不发请求的语义一致）；换文件后清除 rev（回到工作区溯源）且关闭受影响 Modal */
  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== '') {
      setFile(trimmed);
      setRev('');
      setAffectedHash('');
    }
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
          onShowDiff={(hash, parents) => {
            // 根提交（无父）→ root=1；其余 → from=父哈希、to=该提交
            if (parents.length === 0) {
              navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(file)}&root=1`);
            } else {
              navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(file)}&from=${parents[0]}&to=${hash}`);
            }
          }}
          onShowInHistory={(path) => navigate(`/repos/${repoId}/history?file=${encodeURIComponent(path)}`)}
          onShowAffected={setAffectedHash}
          affectedHash={affectedHash}
          affectedEntry={affectedEntry}
          affectedLoading={affectedLoading}
          affectedError={affectedError?.message}
          onCloseAffected={() => setAffectedHash('')}
          onOpenAffectedFile={(path) => {
            // 受影响提交内该文件 diff：from=父哈希、to=该提交（根提交 → root=1；与行内「差异」同语义）
            const entry = affectedEntry;
            if (entry !== undefined && entry !== null) {
              if (entry.parents.length === 0) {
                navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(path)}&root=1`);
              } else {
                navigate(`/repos/${repoId}/diff?file=${encodeURIComponent(path)}&from=${entry.parents[0]}&to=${entry.hash}`);
              }
            }
          }}
        />
      )}
    </Flex>
  );
}
