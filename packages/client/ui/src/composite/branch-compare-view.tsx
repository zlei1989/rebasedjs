/**
 * 分支对比视图（GitCompareBranchesUi 语义）：
 *  双向提交差异——「分支独有」（current..branch）与「当前独有」（branch..current）两组卡片；
 *  行点击 → 日志页 ?select=<hash>（回跳选中）；顶部「退出对比」返回日志页。
 *  纯 props 驱动：数据由容器经双 range 查询注入；行渲染复用 CommitInfo 字段序列。
 */
import { Button, Card, Flex, Tooltip, Typography } from 'antd';
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
          commits.map((c) => (
            // 整行可点：点击即选中该提交（跳日志页定位）；行内无其它可交互元素，故不需要与内层气泡互斥
            <Tooltip key={c.hash} title="选中该提交：跳转到提交日志页并定位到这条记录">
              <Flex
                data-testid={`compare-row-${title}-${c.shortHash}`}
                align="center"
                gap={8}
                style={{ cursor: 'pointer', padding: '4px 0' }}
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
            </Tooltip>
          ))
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
          窄屏交给 wrap 换行。刻意不写 align="flex-start"：本层是横向 Flex、交叉轴为纵向，
          该属性只决定两栏是否等高拉伸，对「横向沾满」本就无影响（根因写法只存在于纵向 Flex 根）。 */}
      <Flex gap={16} wrap="wrap">
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
