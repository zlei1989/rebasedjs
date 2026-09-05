/**
 * 提交搜索页容器：q+mode（组件内状态经 onSearch 上抛）→ useSearch → ui SearchPanel
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate）。
 * 容器只持「已提交的搜索载荷」（null=尚未搜索），q 为空串时 useSearch 挂 null key 不发请求；
 * 结果点击（onSelectCommit）→ 跳日志页 ?select=<hash>（LogPage 以该参数初始化选中提交）。
 */
import { useSearch } from '@rebased/client';
import type { SearchMode } from '@rebased/contracts';
import { SearchPanel } from '@rebased/ui';
import { Button, Flex } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoSearchPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  // 已提交的搜索载荷：SearchPanel 的 q/mode 为其内部状态，经 onSearch 上抛后驱动 hook
  const [search, setSearch] = useState<{ q: string; mode: SearchMode } | null>(null);
  // 仓库切换（两端 SPA 同挂载实例复用）时清空搜索载荷（面板已随 key=repoId 重挂载，查询随之归零）
  useEffect(() => setSearch(null), [repoId]);
  const { data: results, isLoading, error } = useSearch(repoId, search?.q ?? '', search?.mode ?? 'grep');
  return (
    <Flex vertical align="flex-start" gap={8}>
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      <SearchPanel
        key={repoId}
        onSearch={(q, mode) => setSearch({ q, mode })}
        results={results}
        searching={isLoading}
        error={error?.message}
        onSelectCommit={(hash) => navigate(`/repos/${repoId}?select=${hash}`)}
      />
    </Flex>
  );
}
