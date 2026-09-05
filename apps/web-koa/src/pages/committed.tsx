/**
 * Committed Changes 页容器：useCommittedPage 分页（skip 游标按页增长）→ 增量累积 entries → ui CommittedChangesPanel
 * （与 web-next 容器同构；无页内输入，浏览式页面）。
 * 增量累积要点：SWR 以新 key（skip 变化）重取，新响应到达前 data 为 undefined——故以 firstLoaded 守卫首屏
 * （不渲染主体避免闪空）；响应按 hash 去重并入累积列表（服务端游标不重不漏，去重为防御性兜底）。
 * 文件点击（onOpenFile(path, hash)）→ diff 页 from=`${hash}~1`、to=hash（diff 端点已支持 from/to；
 * 提交的变更 = 该提交相对其父提交的对比，即 <hash>~1 → <hash>）。
 */
import { useCommittedPage } from '@rebased/client';
import type { CommittedEntry } from '@rebased/contracts';
import { CommittedChangesPanel } from '@rebased/ui';
import { Button, Flex, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

/** 分页步长（与服务端默认 limit 一致） */
const PAGE_SIZE = 50;

export function RepoCommittedPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [skip, setSkip] = useState(0);
  const [entries, setEntries] = useState<CommittedEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  // 首页已到标记：SWR 新 key（加载更多）期间 data 为 undefined，但累积列表仍有效——不能用 data 守卫渲染
  const [firstLoaded, setFirstLoaded] = useState(false);
  // 面板受控选中提交：容器持有（点击提交行 → 右栏展示其变更文件）
  const [selectedHash, setSelectedHash] = useState<string | undefined>(undefined);
  const { data, isValidating, error } = useCommittedPage(repoId, { limit: PAGE_SIZE, skip });
  // 响应并入累积：data 是「当前窗口」，累积是「已加载全量」
  useEffect(() => {
    if (!data) return;
    setFirstLoaded(true);
    setHasMore(data.hasMore);
    setEntries((prev) => {
      const seen = new Set(prev.map((e) => e.hash));
      return prev.concat(data.entries.filter((e) => !seen.has(e.hash)));
    });
  }, [data]);
  // 仓库切换（两端 SPA 同挂载实例复用）时重置累积：清空条目、游标回零、首屏守卫复位
  useEffect(() => {
    setEntries([]);
    setSkip(0);
    setHasMore(true);
    setFirstLoaded(false);
  }, [repoId]);
  /**
   * 文件点击 → diff 页：from=真实父提交（parents[0]，终审 Must-fix 2——固定 `<hash>~1` 对根提交无父会 128）、
   * to=提交本身；根提交（无父）→ 仅带 root=1 标记，diff 页渲染「无父版本」提示行；
   * R 重命名文件（renameFrom 非空）附加原名——diff 端点只接受单文件路径，页面读 renameFrom 后显示提示行而非伪 diff
   */
  const onOpenFile = (path: string, hash: string): void => {
    const entry = entries.find((e) => e.hash === hash);
    const renameFrom = entry?.files.find((f) => f.path === path)?.renameFrom;
    const parents = entry?.parents ?? [];
    const params = new URLSearchParams({ file: path });
    if (parents.length > 0) {
      params.set('from', parents[0]);
      params.set('to', hash);
    } else {
      params.set('root', '1');
    }
    if (renameFrom) params.set('renameFrom', renameFrom);
    void navigate(`/repos/${repoId}/diff?${params.toString()}`);
  };
  return (
    <Flex vertical align="flex-start" gap={8}>
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {error ? (
        <Typography.Text type="danger" data-testid="committed-error">
          {error.message}
        </Typography.Text>
      ) : null}
      {/* 首屏守卫：首页响应未到不渲染主体（加载态壳层后续任务再补） */}
      {!firstLoaded ? null : (
        <CommittedChangesPanel
          key={repoId}
          page={{ entries, hasMore }}
          onLoadMore={() => setSkip((prev) => prev + PAGE_SIZE)}
          loadingMore={isValidating}
          onSelectCommit={setSelectedHash}
          selectedHash={selectedHash}
          onOpenFile={onOpenFile}
        />
      )}
    </Flex>
  );
}
