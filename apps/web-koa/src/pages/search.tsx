/**
 * 提交搜索页容器：q+mode（组件内状态经 onSearch 上抛）→ useSearch → ui SearchPanel
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate）。
 * 容器只持「已提交的搜索载荷」（null=尚未搜索），q 为空串时 useSearch 挂 null key 不发请求；
 * 结果点击（onSelectCommit）→ 跳日志页 ?select=<hash>（LogPage 以该参数初始化选中提交）。
 */
import { useBranches, useCheckout, useSearch } from '@rebased/client';
import type { SearchMode } from '@rebased/contracts';
import { PageShell, SearchPanel } from '@rebased/ui';
import { Button, Tooltip, message } from 'antd';
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
  // 分支快速搜索（Search Everywhere Git tab 语义）：本地分支列表 + 选中检出（quickswitch）
  const { data: branches } = useBranches(repoId);
  const { trigger: checkout } = useCheckout(repoId);
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  return (
    <PageShell gap={8}>
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      {/* alignSelf: PageShell 刻意不设 alignItems，直接子项会被拉成整行宽、文字居中；就地收回内容宽（保持紧凑左对齐链接观感，原语契约不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button style={{ alignSelf: 'flex-start' }} type="link" onClick={() => navigate(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      <SearchPanel
        key={repoId}
        onSearch={(q, mode) => setSearch({ q, mode })}
        results={results}
        searching={isLoading}
        error={error?.message}
        onSelectCommit={(hash) => navigate(`/repos/${repoId}?select=${hash}`)}
        // 分支快速搜索：选中 → 检出该分支并回日志页（当前分支仅导航）
        branches={branches?.branches.filter((b) => !b.remote) ?? []}
        onSelectBranch={(branch) => {
          checkout({ action: 'branch', name: branch })
            .then(() => {
              void message.success(`已检出 ${branch}`);
              navigate(`/repos/${repoId}`);
            })
            .catch(onError);
        }}
      />
    </PageShell>
  );
}
