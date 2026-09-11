/**
 * 分支对比视图（GitCompareBranchesUi 语义）：
 *  双向提交差异——「分支独有」（current..branch）与「当前独有」（branch..current）两组卡片；
 *  行点击 → 日志页 ?select=<hash>（回跳选中）；顶部「退出对比」返回日志页。
 *  纯 props 驱动：数据由容器经双 range 查询注入；行渲染复用 CommitInfo 字段序列。
 *  两组提交列表走 antd Listy（6.6.0 起的列表组件）：容器/行结构/悬停底色由组件负责，
 *  调用方只给数据与行内容；行**不挂 Tooltip**（产品口径：行不挂气泡，行内按钮的气泡保留）。
 */
import { Button, Card, Flex, Listy, Tooltip, Typography } from 'antd';
import type { CommitInfo } from '@rebased/contracts';
import { PageShell } from '../base/page-shell';
import { formatCommitDate } from '../domain/format';

export interface BranchCompareViewProps {
  /** 对比目标分支名（当前分支由容器从 status.branch 取） */
  branch: string;
  /** 分支独有提交（git log current..branch） */
  branchCommits: CommitInfo[];
  /** 当前分支独有提交（git log branch..current） */
  currentCommits: CommitInfo[];
  onSelectCommit?: (hash: string) => void;
  /** 退出对比（回日志页）回调 */
  onExit?: () => void;
}

/** 单组卡片：标题说明 + 提交行（短哈希 + subject + 作者 + 日期；行点击 → onSelectCommit） */
function CompareCard({
  title,
  hint,
  commits,
  onSelectCommit,
}: {
  title: string;
  hint: string;
  commits: CommitInfo[];
  onSelectCommit?: (hash: string) => void;
}): React.ReactNode {
  return (
    <Card size="small" title={`${title}（${commits.length}）`}>
      <Flex vertical>
        <Typography.Text type="secondary" style={{ fontSize: 12 }} data-testid="compare-hint">
          {hint}
        </Typography.Text>
        {commits.length === 0 ? (
          <Typography.Text type="secondary" style={{ padding: '4px 0' }}>
            无提交
          </Typography.Text>
        ) : (
          /* 提交行走 antd Listy：行容器自带下边框/悬停底色；行内边距沿用改造前的 4px 0（Listy 默认 12px 16px）。
             行**不挂 Tooltip**（产品口径）；整行可点的手型光标是逐行样式故留在行元素上。 */
          <Listy
            items={commits}
            rowKey={(c) => c.hash}
            itemRender={(c) => (
              // 整行可点：点击即选中该提交（跳日志页定位）；行内无可交互元素，气泡冲突面已由「行不挂 Tooltip」消除
              <Flex
                data-testid={`compare-row-${title}-${c.shortHash}`}
                align="center"
                gap={8}
                style={{ padding: '4px 0', cursor: 'pointer' }}
                onClick={() => onSelectCommit?.(c.hash)}
              >
                <Typography.Text code style={{ fontSize: 12, flexShrink: 0 }}>
                  {c.shortHash}
                </Typography.Text>
                <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
                  {c.message}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                  {c.author}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                  {formatCommitDate(c.dateIso)}
                </Typography.Text>
              </Flex>
            )}
          />
        )}
      </Flex>
    </Card>
  );
}

/** 对比视图：两组卡片并排（窄屏自然折行），顶部标题与退出按钮 */
export function BranchCompareView({
  branch,
  branchCommits,
  currentCommits,
  onSelectCommit,
  onExit,
}: BranchCompareViewProps): React.ReactNode {
  // 页面根：/repos/:repoId?compare=<branch> 直接渲染本组件（apps 侧返回的是 fragment 根，无外层布局根），
  // 故由本组件持有密度（不传 density=compact）。gap/padding 照抄既有值 16（PageShell 默认不落 style）。
  return (
    <PageShell gap={16} padding={16}>
      <Flex align="center" gap={12} wrap="wrap">
        <Typography.Text strong data-testid="compare-title">
          与分支 <Typography.Text code>{branch}</Typography.Text> 比较
        </Typography.Text>
        {onExit !== undefined && (
          <Tooltip title="返回提交日志页：退出对比视图（不改动分支与工作树）">
            <Button size="small" data-testid="compare-exit" onClick={onExit}>
              退出对比
            </Button>
          </Tooltip>
        )}
      </Flex>
      {/* 两栏并排容器（非页面根——上面的 PageShell 才是页面根）：两栏各 flex:1 + minWidth:320，
          窄屏交给 wrap 换行。保留 align="flex-start" 是有意的：本层是横向 Flex、交叉轴为纵向，
          故该属性意为「两栏顶部对齐」（不拉伸高度），对「横向沾满」没有任何影响——
          宽度根因只存在于纵向 Flex（交叉轴为水平），那是页面根，已由上面的 PageShell 修复。 */}
      <Flex gap={16} align="flex-start" wrap="wrap">
        <Flex vertical gap={16} style={{ flex: 1, minWidth: 320 }}>
          <CompareCard
            title="分支独有"
            hint={`仅在 ${branch} 存在的提交（current..${branch}）`}
            commits={branchCommits}
            onSelectCommit={onSelectCommit}
          />
        </Flex>
        <Flex vertical gap={16} style={{ flex: 1, minWidth: 320 }}>
          <CompareCard
            title="当前独有"
            hint={`仅在当前分支存在的提交（${branch}..current）`}
            commits={currentCommits}
            onSelectCommit={onSelectCommit}
          />
        </Flex>
      </Flex>
    </PageShell>
  );
}
