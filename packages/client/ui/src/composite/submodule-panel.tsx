/**
 * 子模块面板：列表（name / path / url / branch / status 四徽标 / commitSha 短哈希——branch 与
 *  commitSha 可选，缺省省略）+ 行内「更新」（onUpdate({name})）
 *  + 顶部「更新全部」（recursive Checkbox 默认不勾：未勾 → onUpdate({})，不带 recursive 键；
 *  勾选 → onUpdate({recursive:true})——契约 optional 缺省省略惯例）；刷新可选（缺省不渲染）。
 *  纯 props 驱动：ui 不调接口，数据与全部回调由调用方容器注入；操作失败反馈由容器负责。
 */
import { useState } from 'react';
import { Button, Card, Checkbox, Flex, Tag, Tooltip, Typography } from 'antd';
import type { SubmoduleEntry, SubmoduleList, SubmoduleUpdateBody } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { EllipsisText } from '../base/ellipsis-text';
import { Toolbar } from '../base/toolbar';

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
      {/* path 是不可断行的长串（与 URL 同风险，原 `flexShrink: 0` 会把行顶宽）→ EllipsisText 截断；
          次要色由 `type="secondary"` 转发保留，`title` 给完整路径；
          path 既非 hash 也非 ref，故不加 `mono`（Ruling P17 的 mono 口径只覆盖 hash/ref）；
          `fontSize: 12` 交紧凑密度（Ruling P4），`flexShrink: 0` 去掉（可收缩正是目的）。 */}
      <EllipsisText type="secondary" title={entry.path}>
        {entry.path}
      </EllipsisText>
      {/* 远端 URL 改 EllipsisText（brief Step 2 点名处）：自带 minWidth:0 + ellipsis + maxWidth，
          长 URL 不再撑宽行；由原 inline 样式承担的三项随之交接：
          ellipsis（内置）、maxWidth:220（改为 prop）、flexShrink:0（去掉——可收缩正是目的）；
          fontSize:12 交紧凑密度（Ruling P4）。
          `type="secondary"` 现在由 EllipsisText 转发（Ruling P17 为本原语补了 type prop），
          原先「转换即丢次要色」的缺口在此闭合；URL 非 hash/ref，不加 `mono`。 */}
      <EllipsisText type="secondary" maxWidth={220} title={entry.url}>
        {entry.url}
      </EllipsisText>
      {entry.branch !== undefined ? (
        // 分支名是不可断行的 ref → 同口径转 EllipsisText；次要色转发保留，
        // `mono` 按 Ruling P17 的 ref 口径，`title` 给完整分支名，`flexShrink: 0` 去掉（可收缩正是目的）。
        <EllipsisText type="secondary" mono title={entry.branch}>
          {entry.branch}
        </EllipsisText>
      ) : null}
      {entry.commitSha !== undefined ? (
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {entry.commitSha.slice(0, 7)}
        </Typography.Text>
      ) : null}
      {/* 行内「更新」：只更新这一行子模块（不带 recursive）。
          acting 期间禁用，禁用按钮不派发 hover → 在 Tooltip 与 Button 之间包 span 承接提示；
          inline-flex 让 span 紧贴按钮，不改变原 Flex 行布局尺寸 */}
      <Tooltip
        title={
          acting
            ? '子模块操作进行中，完成后再更新这一行'
            : '按 .gitmodules 记录的提交更新该子模块：会改动它自己的工作区内容'
        }
      >
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            data-testid={`submodule-update-${entry.name}`}
            disabled={acting}
            onClick={() => onUpdate({ name: entry.name })}
          >
            更新
          </Button>
        </span>
      </Tooltip>
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
          /* 卡头工具行改 Toolbar（gap 照抄原值 8；交叉轴 align 固定 center，与原 align="center" 等价）：
             原 Flex 不换行，窄屏「刷新/递归更新/更新全部」会溢出卡头；宿主 `.ant-card-extra` 是
             `flex: 0 1 auto` 的收缩项，子项 100% 按它自己的内容盒解析，宽屏等价、窄屏获得换行能力。
             子项均为按钮/勾选，无需补 minWidth:0。 */
          <Toolbar gap={8}>
            {onRefresh !== undefined ? (
              /* 刷新：只重新读取状态，不改工作区；acting 禁用期间同样靠外层 span 承接提示 */
              <Tooltip
                title={
                  acting ? '子模块操作进行中，完成后再刷新列表' : '重新读取 .gitmodules 与各子模块的检出状态（只读，不改工作区）'
                }
              >
                <span style={{ display: 'inline-flex' }}>
                  <Button size="small" data-testid="submodule-refresh" disabled={acting} onClick={onRefresh}>
                    刷新
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {/* 递归开关：决定「更新全部」的作用深度，禁用期间也靠 span 承接提示（Checkbox 禁用同样不派发 hover） */}
            <Tooltip
              title={
                acting
                  ? '子模块操作进行中，完成后再修改该选项'
                  : '勾选后「更新全部」连带更新子模块内部的嵌套子模块；不勾只更新第一层'
              }
            >
              <span style={{ display: 'inline-flex' }}>
                <Checkbox checked={recursive} disabled={acting} onChange={(e) => setRecursive(e.target.checked)}>
                  递归更新
                </Checkbox>
              </span>
            </Tooltip>
            {/* 更新全部：作用对象是整张列表（区别于每行的「更新」），深度取决于左侧递归开关 */}
            <Tooltip
              title={
                acting
                  ? '子模块操作进行中，完成后再批量更新'
                  : '更新列表中全部子模块：勾选左侧「递归更新」时连带其内部的嵌套子模块'
              }
            >
              <span style={{ display: 'inline-flex' }}>
                <Button
                  size="small"
                  data-testid="submodule-update-all"
                  disabled={acting}
                  onClick={() => onUpdate(recursive ? { recursive: true } : {})}
                >
                  更新全部
                </Button>
              </span>
            </Tooltip>
          </Toolbar>
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
