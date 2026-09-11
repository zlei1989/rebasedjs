/**
 * 提交搜索面板：搜索框（关键词 q）+ 模式选择（Segmented：信息 grep / 内容 pickaxe）+ 结果列表。
 *  提交 → onSearch(q, mode)（容器持 SWR 数据）；结果行点击 → onSelectCommit 完整哈希。
 *  分支快速搜索（Search Everywhere Git tab 语义）：分支输入即滤（文本即滤约定同 LogPage），
 *  行点击 → onSelectBranch（容器做检出/导航）。
 *  q 与 mode 为组件内简单状态（接口无对应受控 prop）；results/searching/error 与全部回调由容器注入。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Segmented, Spin, Tag, Tooltip, Typography } from 'antd';
import type { BranchRef, SearchMode, SearchResult } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { PageShell } from '../base/page-shell';
import { Toolbar } from '../base/toolbar';
import { formatCommitDate } from '../domain/format';

export interface SearchPanelProps {
  onSearch: (q: string, mode: SearchMode) => void;
  results?: SearchResult[];
  searching?: boolean;
  error?: string;
  onSelectCommit?: (hash: string) => void;
  /** 分支快速搜索数据源（本地分支列表）；与 onSelectBranch 同传时渲染「分支快速搜索」卡片 */
  branches?: BranchRef[];
  /** 分支行选择回调（容器负责检出/导航） */
  onSelectBranch?: (branch: string) => void;
}

/** 模式选项：信息 grep = 提交信息全文（--grep）；内容 pickaxe = 内容增量（-S） */
const MODE_OPTIONS: { label: string; value: SearchMode }[] = [
  { label: '信息 grep', value: 'grep' },
  { label: '内容 pickaxe', value: 'pickaxe' },
];

/** 结果行：短哈希 + subject（弹性）+ 作者 + 日期；整行点击 → onSelectCommit 完整哈希 */
function ResultRow({
  result,
  index,
  onSelectCommit,
}: {
  result: SearchResult;
  index: number;
  onSelectCommit?: (hash: string) => void;
}): React.ReactNode {
  return (
    /* 整行可点（未注入 onSelectCommit 时不挂有效回调）→ 行 Tooltip 说明点击后果；
       Flex 是 antd 容器组件，脚本按容器豁免，这里按「可点行」口径人工补上 */
    <Tooltip title={onSelectCommit ? '打开该提交：跳到提交日志并选中这一条' : undefined}>
      <Flex
        data-testid={`search-result-${index}`}
        align="center"
        gap={8}
        style={{ padding: '4px 0', cursor: onSelectCommit ? 'pointer' : undefined }}
        onClick={() => onSelectCommit?.(result.hash)}
      >
        <Typography.Text code style={{ flexShrink: 0 }}>
          {result.shortHash}
        </Typography.Text>
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {result.subject}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {result.author}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {formatCommitDate(result.dateIso)}
        </Typography.Text>
      </Flex>
    </Tooltip>
  );
}

/** 分支快速搜索卡片：输入即滤（本地分支名子串），行 = 分支名 + current 徽标；点击 → onSelectBranch */
function BranchQuickSearch({
  branches,
  onSelectBranch,
}: {
  branches: BranchRef[];
  onSelectBranch: (branch: string) => void;
}): React.ReactNode {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const matched = needle === '' ? branches : branches.filter((b) => b.name.toLowerCase().includes(needle));

  return (
    <Card size="small" title="分支快速搜索">
      <Flex vertical gap={8}>
        {/* 输入即滤：说明作用对象（下方分支列表）与前提（纯前端过滤，不发请求） */}
        <Tooltip title="按分支名过滤下方列表：输入子串即时筛选（纯前端过滤，不发请求），清空恢复全部">
          <Input
            data-testid="branch-quick-input"
            placeholder="输入分支名（文本即滤）"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Tooltip>
        {matched.length === 0 ? (
          <Typography.Text type="secondary">无匹配分支</Typography.Text>
        ) : (
          <Flex vertical>
            {matched.map((b) => (
              /* 整行可点 → 行 Tooltip 说明点击后果（分支名本身不自解释「点了会怎样」） */
              <Tooltip key={b.name} title={b.current ? '当前分支：重新检出到它并跳到其提交日志' : `检出分支 ${b.name} 并跳到其提交日志`}>
                <Flex
                  data-testid={`branch-quick-${b.name}`}
                  align="center"
                  gap={8}
                  style={{ cursor: 'pointer', padding: '4px 0' }}
                  onClick={() => onSelectBranch(b.name)}
                >
                  <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
                    {b.name}
                  </Typography.Text>
                  {b.current && <Tag color="green">当前</Tag>}
                </Flex>
              </Tooltip>
            ))}
          </Flex>
        )}
      </Flex>
    </Card>
  );
}

export function SearchPanel({
  onSearch,
  results,
  searching,
  error,
  onSelectCommit,
  branches,
  onSelectBranch,
}: SearchPanelProps): React.ReactNode {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<SearchMode>('grep');

  /** 提交搜索：空白关键词不触发（与容器 null-key 不发请求语义一致），trim 后回调 */
  const submit = (): void => {
    const trimmed = q.trim();
    if (trimmed !== '') onSearch(trimmed, mode);
  };

  return (
    /* 根容器是纵向列（页内面板，非路由根）：按迁移配方换 PageShell 得到 width:100% + minWidth:0 + height:100%。
       密度传 "default" 只豁免密度——本组件被 apps 侧页面容器（search.tsx:29 的 align 根）嵌入，
       该容器才是本路由的密度归属方，面板自身不得再施加一层紧凑密度；
       gap/padding 照抄既有值 8/16（PageShell 默认不落 style，不传会静默丢掉内距与行距）。 */
    <PageShell density="default" gap={8} padding={16}>
      {/* 分支快速搜索（Search Everywhere Git tab 语义）：branches + onSelectBranch 同传时渲染 */}
      {branches !== undefined && onSelectBranch !== undefined && (
        <BranchQuickSearch branches={branches} onSelectBranch={onSelectBranch} />
      )}
      {/* 过滤行改 Toolbar：横向行容器（交叉轴为纵向，故此处不涉及横向沾满），
         统一换行以免窄屏把输入框与按钮挤成溢出；输入框补 flex:1 + minWidth:0 学会收缩。 */}
      <Toolbar gap={8}>
        {/* 关键词输入框：说明回车等价操作与检索范围（模式由下方 Segmented 决定） */}
        <Tooltip title="输入提交关键词：回车等同点「搜索」；命中范围取决于下方所选模式，空白关键词不发起检索">
          <Input
            data-testid="search-input"
            placeholder="搜索提交信息或内容"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onPressEnter={submit}
            style={{ flex: 1, minWidth: 0 }}
          />
        </Tooltip>
        {/* 关键词为空时禁用（空白查询无意义），禁用按钮不派发 hover → 按 antd 官方做法
            在 Tooltip 与 Button 间包一层 span 承接提示；inline-flex 保持原行内布局尺寸 */}
        <Tooltip title={q.trim() === '' ? '先在左侧输入关键词，空白关键词不发起检索' : '按当前关键词与所选模式检索提交，结果列在下方'}>
          <span style={{ display: 'inline-flex' }}>
            <Button
              type="primary"
              data-testid="search-submit"
              // antd 对双汉字按钮默认自动插空格「搜 索」：关闭保证按钮可见文本与无障碍名精确为「搜索」
              autoInsertSpace={false}
              disabled={q.trim() === ''}
              loading={searching}
              onClick={submit}
            >
              搜索
            </Button>
          </span>
        </Tooltip>
      </Toolbar>
      {/* 模式开关：说明两个选项各自的检索口径（文字标签本身不自解释差异） */}
      <Tooltip title="切换检索模式：信息 grep 匹配提交信息全文，内容 pickaxe 匹配新增/删除的内容行">
        <Segmented options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v as SearchMode)} />
      </Tooltip>
      {searching ? (
        <Spin data-testid="search-loading" />
      ) : error ? (
        <Typography.Text type="danger" data-testid="search-error">
          {error}
        </Typography.Text>
      ) : results && results.length > 0 ? (
        <Card size="small" title={`搜索结果（${results.length}）`}>
          <Flex vertical>
            {results.map((result, index) => (
              <ResultRow key={result.hash} result={result} index={index} onSelectCommit={onSelectCommit} />
            ))}
          </Flex>
        </Card>
      ) : (
        /* results 未注入 = 尚未搜索，与搜索无命中（空数组）区分文案 */
        <EmptyState title={results === undefined ? '输入关键词开始搜索' : '暂无搜索结果'} />
      )}
    </PageShell>
  );
}
