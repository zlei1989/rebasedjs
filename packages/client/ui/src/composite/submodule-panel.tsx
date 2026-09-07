/**
 * 子模块面板：列表（name / path / url / branch / status 四徽标 / commitSha 短哈希——branch 与
 *  commitSha 可选，缺省省略）+ 行内「更新」（onUpdate({name})）
 *  + 顶部「更新全部」（recursive Checkbox 默认不勾：未勾 → onUpdate({})，不带 recursive 键；
 *  勾选 → onUpdate({recursive:true})——契约 optional 缺省省略惯例）；刷新可选（缺省不渲染）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Checkbox, Flex, Tag, Typography } from 'antd';
import type { SubmoduleEntry, SubmoduleList, SubmoduleUpdateBody } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';

export interface SubmodulePanelProps {
  submodules: SubmoduleList;
  /** 行内 → {name}; 全量 → {recursive?}（recursive 未勾 → {}，不带 recursive 键） */
  onUpdate: (body: SubmoduleUpdateBody) => void;
  acting?: boolean;
  /** 刷新列表：缺省不渲染刷新按钮 */
  onRefresh?: () => void;
}

/** status → 徽标文案/配色：uninitialized 橙 / checked-out 绿 / different-commit 红 / conflict 红 */
const STATUS_META: Record<SubmoduleEntry['status'], { label: string; color: string }> = {
  uninitialized: { label: '未初始化', color: 'orange' },
  'checked-out': { label: '已检出', color: 'green' },
  'different-commit': { label: '提交漂移', color: 'error' },
  conflict: { label: '冲突', color: 'error' },
};

/** 子模块行：name（弹性省略）+ status 徽标 + path/url/branch/commitSha 短哈希（可选字段缺省省略）+ 行内更新 */
function SubmoduleRow({
  entry,
  acting,
  onUpdate,
}: {
  entry: SubmoduleEntry;
  acting?: boolean;
  onUpdate: (body: SubmoduleUpdateBody) => void;
}): React.ReactNode {
  const meta = STATUS_META[entry.status];
  return (
    <Flex data-testid={`submodule-row-${entry.name}`} align="center" gap={8} style={{ padding: '4px 0' }}>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {entry.name}
      </Typography.Text>
      <Tag color={meta.color} data-testid={`submodule-status-${entry.name}`} style={{ flexShrink: 0 }}>
        {meta.label}
      </Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {entry.path}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0, maxWidth: 220 }} ellipsis>
        {entry.url}
      </Typography.Text>
      {entry.branch !== undefined ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {entry.branch}
        </Typography.Text>
      ) : null}
      {entry.commitSha !== undefined ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {entry.commitSha.slice(0, 7)}
        </Typography.Text>
      ) : null}
      <Button
        size="small"
        data-testid={`submodule-update-${entry.name}`}
        disabled={acting}
        onClick={() => onUpdate({ name: entry.name })}
      >
        更新
      </Button>
    </Flex>
  );
}

export function SubmodulePanel(props: SubmodulePanelProps): React.ReactNode {
  const { submodules, onUpdate, acting, onRefresh } = props;
  const [recursive, setRecursive] = useState(false);

  return (
    <Flex vertical gap={16} style={{ padding: 16 }}>
      <Card
        size="small"
        title={`子模块（${submodules.submodules.length}）`}
        extra={
          <Flex gap={8} align="center">
            {onRefresh !== undefined ? (
              <Button size="small" data-testid="submodule-refresh" disabled={acting} onClick={onRefresh}>
                刷新
              </Button>
            ) : null}
            <Checkbox checked={recursive} disabled={acting} onChange={(e) => setRecursive(e.target.checked)}>
              递归更新
            </Checkbox>
            <Button
              size="small"
              data-testid="submodule-update-all"
              disabled={acting}
              onClick={() => onUpdate(recursive ? { recursive: true } : {})}
            >
              更新全部
            </Button>
          </Flex>
        }
      >
        {submodules.submodules.length === 0 ? (
          <EmptyState title="无子模块" description="未检测到 .gitmodules" />
        ) : (
          <Flex vertical>
            {submodules.submodules.map((entry) => (
              <SubmoduleRow key={entry.name} entry={entry} acting={acting} onUpdate={onUpdate} />
            ))}
          </Flex>
        )}
      </Card>
    </Flex>
  );
}
