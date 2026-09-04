/**
 * 提交搜索面板：搜索框（关键词 q）+ 模式选择（Segmented：信息 grep / 内容 pickaxe）+ 结果列表。
 *  提交 → onSearch(q, mode)（容器持 SWR 数据）；结果行点击 → onSelectCommit 完整哈希。
 *  q 与 mode 为组件内简单状态（接口无对应受控 prop）；results/searching/error 与全部回调由容器注入。
 */
import { useState } from 'react';
import { Button, Card, Flex, Input, Segmented, Spin, Typography } from 'antd';
import type { SearchMode, SearchResult } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface SearchPanelProps {
  onSearch: (q: string, mode: SearchMode) => void;
  results?: SearchResult[];
  searching?: boolean;
  error?: string;
  onSelectCommit?: (hash: string) => void;
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
  );
}

export function SearchPanel({ onSearch, results, searching, error, onSelectCommit }: SearchPanelProps): React.ReactNode {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<SearchMode>('grep');

  /** 提交搜索：空白关键词不触发（与容器 null-key 不发请求语义一致），trim 后回调 */
  const submit = (): void => {
    const trimmed = q.trim();
    if (trimmed !== '') onSearch(trimmed, mode);
  };

  return (
    <Flex vertical gap={8} style={{ padding: 16 }}>
      <Flex gap={8}>
        <Input
          data-testid="search-input"
          placeholder="搜索提交信息或内容"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onPressEnter={submit}
        />
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
      </Flex>
      <Segmented options={MODE_OPTIONS} value={mode} onChange={(v) => setMode(v as SearchMode)} />
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
    </Flex>
  );
}
