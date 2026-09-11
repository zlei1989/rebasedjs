/**
 * GitHub 面板：左列表（number/title/author/state 徽标/更新时间）+ 右详情（标题/主体/元信息/reviewDecision 徽标/增删行统计）+ tabs（时间线 | 文件）+ 操作区（评论、Approve、Request changes、合并 Modal、检出、刷新）。
 *  纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入（hooks 在应用层装配）；
 *  状态切换 Tab 由容器/页面做，面板只渲染当前 state 的 prs；细节：单击选中、merged 加「已合并」标记、
 *  评论输入框与 review body 共用、REQUEST_CHANGES 带 body、patch 空串不渲染展开区。
 */
import { useState } from 'react';
import {
  Button,
  Card,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type {
  GitHubPrDetail,
  GitHubPrFile,
  GitHubPrFiles,
  GitHubPrList,
  GitHubPrSummary,
  GitHubReviewComment,
  GitHubReviewCommentBody,
  GitHubReviewComments,
  GitHubStatus,
  GitHubTimeline,
  GitHubTimelineEntry,
} from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';
import { HunkDiffView } from '../domain/hunk-diff-view';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';

/** GitHub 面板：左列表（number/title/author/state 徽标/更新时间）+ 右详情（标题/主体/元信息/reviewDecision 徽标/增删行统计）+ tabs（时间线 | 文件）+ 操作区（评论、Approve、Request changes、合并 Modal、检出、刷新） */
export interface GitHubPanelProps {
  status: GitHubStatus;
  prs: GitHubPrList; number: number | null;
  detail: GitHubPrDetail | null; timeline: GitHubTimeline | null; files: GitHubPrFiles | null;
  /** 行级评审评论（PR 全量，纯展示/线程挂靠由 ui 按 path 过滤）；null 视同无 */
  reviewComments?: GitHubReviewComments | null;
  loading?: boolean; acting?: boolean;
  /** 添加行级评审评论进行中 */
  commentActing?: boolean;
  /** 添加行级评审评论回调（容器接 useAddGithubPrReviewComment） */
  onAddReviewComment?: (body: GitHubReviewCommentBody) => void;
  /** 测试注入点：行级差异视图的 Monaco 加载器（缺省懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
  onSelectPr: (number: number) => void;
  /** 刷新列表/详情：缺省不渲染刷新按钮 */
  onRefresh?: () => void;
  onComment: (body: string) => void; onReview: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) => void;
  onMerge: (method: 'merge' | 'squash' | 'rebase') => void; onCheckout: () => void;
}

/** reviewDecision → 徽标配色：APPROVED 绿 / CHANGES_REQUESTED 橙 / REVIEW_REQUIRED 红；NONE 不渲染徽标 */
const REVIEW_DECISION_COLORS: Record<GitHubPrDetail['reviewDecision'], string> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  REVIEW_REQUIRED: 'error',
  NONE: 'default',
};

/** 时间线 review 决定 → 徽标配色（APPROVED 绿 / CHANGES_REQUESTED 橙 / COMMENTED 灰） */
const REVIEW_STATE_COLORS: Record<NonNullable<GitHubTimelineEntry['reviewState']>, string> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  COMMENTED: 'default',
};

/** 文件 status → 徽标配色：added 绿 / modified 蓝 / removed 红 / renamed 紫 */
const FILE_STATUS_COLORS: Record<GitHubPrFile['status'], string> = {
  added: 'green',
  modified: 'blue',
  removed: 'red',
  renamed: 'purple',
};

/** 合并方式三选：value 对齐 GitHub API merge_method，label 为中文说明 */
const MERGE_METHODS: Array<{ value: 'merge' | 'squash' | 'rebase'; label: string }> = [
  { value: 'merge', label: '创建合并提交' },
  { value: 'squash', label: '压缩为单个提交' },
  { value: 'rebase', label: '变基合并' },
];

/** 合并方式 → 悬停提示：说明各自在目标分支上留下什么提交历史（不复述可见 label，避免测试 getByText 撞重） */
const MERGE_METHOD_TIPS: Record<'merge' | 'squash' | 'rebase', string> = {
  merge: '保留全部提交历史：以合并提交并入目标分支',
  squash: '只留一个提交：把分支上的改动压缩成单个提交并入',
  rebase: '线性历史：把分支提交逐个变基到目标分支之上，不产生合并提交',
};

/** PR 列表行：number/title/author/state 徽标（open 绿/closed 灰）+ 已合并标记 + 更新时间；整行单击 → onSelectPr；命中选择高亮 */
function PrRow({
  pr,
  selected,
  onSelect,
}: {
  pr: GitHubPrSummary;
  selected: boolean;
  onSelect: (number: number) => void;
}): React.ReactNode {
  // 选中底色走主题 token（明亮 #e6f4ff / 暗色 #111a2c），不再硬编码明亮专用色
  const { token } = theme.useToken();
  // 整行可点 → 气泡挂在行本身（Flex 是真实 DOM 节点）：
  // 调用处再包一层会与行内气泡叠加成两个气泡，故行 Tooltip 归组件自己持有
  return (
    <Tooltip title="选中该 PR：在右侧详情列加载描述、时间线与文件变更">
      <Flex
        data-testid={`github-pr-row-${pr.number}`}
        align="center"
        gap={8}
        style={{
          padding: '4px 8px',
          cursor: 'pointer',
          backgroundColor: selected ? token.controlItemBgActive : undefined,
        }}
        onClick={() => onSelect(pr.number)}
      >
        <Tag style={{ flexShrink: 0 }}>{`#${pr.number}`}</Tag>
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {pr.title}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {pr.author}
        </Typography.Text>
        <Tag color={pr.state === 'open' ? 'success' : 'default'} style={{ flexShrink: 0 }}>
          {pr.state}
        </Tag>
        {pr.merged ? (
          <Tag color="blue" style={{ flexShrink: 0 }}>
            已合并
          </Tag>
        ) : null}
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {formatCommitDate(pr.updatedAtIso)}
        </Typography.Text>
      </Flex>
    </Tooltip>
  );
}

/** 时间线条目：kind 徽标（comment 评论/review 审查+reviewState）+ author + 时间 + body（保留换行） */
function TimelineRow({ entry }: { entry: GitHubTimelineEntry }): React.ReactNode {
  return (
    <Flex vertical data-testid={`github-timeline-${entry.id}`} style={{ padding: '4px 0' }}>
      <Flex align="center" gap={8}>
        <Tag color={entry.kind === 'review' ? 'blue' : 'default'} style={{ flexShrink: 0 }}>
          {entry.kind === 'review' ? '审查' : '评论'}
        </Tag>
        {entry.reviewState ? (
          <Tag color={REVIEW_STATE_COLORS[entry.reviewState]} style={{ flexShrink: 0 }}>
            {entry.reviewState}
          </Tag>
        ) : null}
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {entry.author}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {formatCommitDate(entry.atIso)}
        </Typography.Text>
      </Flex>
      {entry.body !== '' ? (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {entry.body}
        </Typography.Paragraph>
      ) : null}
    </Flex>
  );
}

/** 文件行：path/status 徽标/增删行 + 「查看差异」展开区（行级视图：逐 hunk 两侧 MonacoDiffView + 行级评论线程，2026-09-08 裁定 §2.7）；
 *  patch 空串时仅 renamed（无内容变更）与 removed（二进制/截断）渲染展开——由 HunkDiffView 降级提示 */
function FileRow({
  file,
  index,
  comments,
  onAddReviewComment,
  commentActing,
  loader,
}: {
  file: GitHubPrFile;
  index: number;
  /** 该文件的行级评审评论（容器已按 path 过滤；line=null 的无锚点条目在此丢弃） */
  comments: GitHubReviewComment[];
  onAddReviewComment?: (body: GitHubReviewCommentBody) => void;
  commentActing?: boolean;
  loader?: MonacoDiffLoader;
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false);

  return (
    <Flex vertical data-testid={`github-file-${index}`} style={{ padding: '4px 0' }}>
      <Flex align="center" gap={8}>
        <Tag color={FILE_STATUS_COLORS[file.status]} style={{ flexShrink: 0 }}>
          {file.status}
        </Tag>
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {file.path}
        </Typography.Text>
        <Typography.Text type="success" style={{ fontSize: 12, flexShrink: 0 }}>{`+${file.additions}`}</Typography.Text>
        <Typography.Text type="danger" style={{ fontSize: 12, flexShrink: 0 }}>{`-${file.deletions}`}</Typography.Text>
      </Flex>
      {file.patch !== '' || file.status === 'renamed' ? (
        <Flex vertical gap={4}>
          <Tooltip
            title={
              expanded
                ? '收起该文件的逐 hunk 差异视图'
                : '展开该文件的逐 hunk 差异视图：逐 hunk 两侧对照，可挂行级评论'
            }
          >
            <Button
              type="link"
              size="small"
              data-testid={`github-diff-toggle-${index}`}
              style={{ alignSelf: 'flex-start', padding: 0 }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? '收起差异' : '查看差异'}
            </Button>
          </Tooltip>
          {expanded ? (
            <HunkDiffView
              patch={file.patch}
              status={file.status}
              loader={loader}
              comments={comments
                .filter((c) => c.line !== null)
                .map((c) => ({ id: String(c.id), line: c.line as number, author: c.author, atIso: c.atIso, body: c.body }))}
              adding={commentActing}
              onAddComment={(line, body) => onAddReviewComment?.({ path: file.path, line, side: 'RIGHT', body })}
            />
          ) : null}
        </Flex>
      ) : null}
    </Flex>
  );
}

/** 合并 PR Modal：三方法 Radio（merge/squash/rebase，默认 merge）+ 说明；确认调 onMerge；关闭时复位为 merge */
function MergePrModal({
  open,
  pr,
  acting,
  onMerge,
  onClose,
}: {
  open: boolean;
  pr: GitHubPrDetail;
  acting?: boolean;
  onMerge: (method: 'merge' | 'squash' | 'rebase') => void;
  onClose: () => void;
}): React.ReactNode {
  const [method, setMethod] = useState<'merge' | 'squash' | 'rebase'>('merge');
  /** 悬停中的合并方式分组：分组气泡只在悬停「分组本身」（而非某个选项）时显示 */
  const [groupHover, setGroupHover] = useState(false);
  /** 悬停中的具体合并方式选项：抑制分组气泡，避免分组与选项两个气泡同时弹出 */
  const [optionHover, setOptionHover] = useState(false);

  /** 关闭时复位（Modal 默认不卸载子树，取消后重开不能残留上次选择） */
  const close = (): void => {
    setMethod('merge');
    onClose();
  };

  const submit = (): void => {
    onMerge(method);
    close();
  };

  return (
    <Modal
      title={`合并 PR #${pr.number}`}
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          选择合并方式：合并后 PR 将在 GitHub 上标记为已合并。
        </Typography.Text>
        {/* Radio.Group 自身也是可交互控件 → 自带气泡；open 受控：悬停到具体选项时抑制，
            否则分组气泡与选项气泡会同时弹出互相干扰（同 repo-page 行/行内按钮的抑制思路） */}
        <Tooltip
          title="选择合并方式：决定 PR 并入目标分支后留下的提交历史形态"
          open={groupHover && !optionHover}
        >
          <Radio.Group
            value={method}
            onChange={(e) => setMethod(e.target.value as 'merge' | 'squash' | 'rebase')}
            onMouseEnter={() => setGroupHover(true)}
            onMouseLeave={() => setGroupHover(false)}
          >
            <Flex vertical gap={4}>
              {MERGE_METHODS.map((m) => (
                <Tooltip key={m.value} title={MERGE_METHOD_TIPS[m.value]}>
                  <Radio
                    value={m.value}
                    onMouseEnter={() => setOptionHover(true)}
                    onMouseLeave={() => setOptionHover(false)}
                  >
                    {m.label}
                  </Radio>
                </Tooltip>
              ))}
            </Flex>
          </Radio.Group>
        </Tooltip>
      </Flex>
    </Modal>
  );
}

/** 详情块（detail 非空时渲染）：标题/元信息/主体 + 操作区（评论输入框共用 review body）+ tabs（时间线 | 文件） */
function PrDetailBlock({
  detail,
  timeline,
  files,
  reviewComments,
  acting,
  commentActing,
  loader,
  onAddReviewComment,
  onComment,
  onReview,
  onMerge,
  onCheckout,
}: {
  detail: GitHubPrDetail;
  timeline: GitHubTimeline | null;
  files: GitHubPrFiles | null;
  /** 行级评审评论（全量文件混合）；FileRow 内按 path 过滤 */
  reviewComments: GitHubReviewComment[] | null;
  acting?: boolean;
  /** 添加行级评论进行中：hunk 线程发送按钮 loading */
  commentActing?: boolean;
  /** 测试注入点：行级差异视图的 Monaco 加载器（缺省懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
  /** 添加行级评审评论回调（path + line + side + body 由 ui 组装，容器接 hook） */
  onAddReviewComment?: (body: GitHubReviewCommentBody) => void;
  onComment: (body: string) => void;
  onReview: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) => void;
  onMerge: (method: 'merge' | 'squash' | 'rebase') => void;
  onCheckout: () => void;
}): React.ReactNode {
  const [comment, setComment] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);

  /** 发送评论：以输入框内容调 onComment 并清空输入 */
  const sendComment = (): void => {
    onComment(comment);
    setComment('');
  };

  /** Request changes：同一输入框内容作 review body（空则省略 body），并清空输入 */
  const requestChanges = (): void => {
    const body = comment.trim() === '' ? undefined : comment;
    onReview('REQUEST_CHANGES', body);
    setComment('');
  };

  return (
    <Flex vertical gap={12}>
      <Typography.Title level={5} style={{ margin: 0 }} data-testid="github-detail-title">
        {detail.title}
      </Typography.Title>
      <Flex align="center" gap={12} wrap>
        <Typography.Text type="secondary" data-testid="github-detail-author">
          {detail.author}
        </Typography.Text>
        <Typography.Text type="secondary" data-testid="github-detail-number">{`#${detail.number}`}</Typography.Text>
        <Typography.Text type="secondary" data-testid="github-detail-refs">
          {detail.baseRef} ← {detail.headRef}
        </Typography.Text>
        {detail.reviewDecision !== 'NONE' ? (
          <Tag color={REVIEW_DECISION_COLORS[detail.reviewDecision]} data-testid="github-review-decision">
            {detail.reviewDecision}
          </Tag>
        ) : null}
        <Typography.Text type="success" data-testid="github-additions">{`+${detail.additions}`}</Typography.Text>
        <Typography.Text type="danger" data-testid="github-deletions">{`-${detail.deletions}`}</Typography.Text>
      </Flex>
      <Typography.Paragraph data-testid="github-body" style={{ whiteSpace: 'pre-wrap' }}>
        {detail.body}
      </Typography.Paragraph>
      <Flex vertical gap={8}>
        <Tooltip title="输入评论或 review 说明：发送评论与 Request changes 共用这段文字">
          <Input.TextArea
            data-testid="github-comment-input"
            rows={3}
            placeholder="评论或 review 说明"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Tooltip>
        <Flex gap={8} wrap>
          {/* 空内容 / 上一个操作进行中时该按钮禁用；antd 禁用按钮不派发 hover，
              故在 Tooltip 与 Button 之间包一层 inline-flex span 承接悬停，文案说明不可用的原因 */}
          <Tooltip
            title={
              acting
                ? '上一个操作进行中：完成后才能发送'
                : comment.trim() === ''
                  ? '先输入评论内容：空内容不发送'
                  : '把上方输入框的内容作为评论发到该 PR'
            }
          >
            <span style={{ display: 'inline-flex' }}>
              <Button
                type="primary"
                data-testid="github-send-comment"
                disabled={acting || comment.trim() === ''}
                onClick={sendComment}
              >
                发送评论
              </Button>
            </span>
          </Tooltip>
          <Popconfirm
            title="批准该 PR？"
            okText="确定"
            cancelText="取消"
            onConfirm={() => onReview('APPROVE')}
          >
            {/* Tooltip 放最内层（Popconfirm > Tooltip > span > Button）保持 Popconfirm 触发链完整；
                acting 时按钮禁用 → 由 span 承接 hover，文案说明为什么不可点 */}
            <Tooltip
              title={
                acting
                  ? '上一个操作进行中：完成后才能批准'
                  : '批准该 PR：确认后在 GitHub 上记录一次 APPROVED 审查（不附评论内容）'
              }
            >
              <span style={{ display: 'inline-flex' }}>
                <Button data-testid="github-approve" disabled={acting}>
                  Approve
                </Button>
              </span>
            </Tooltip>
          </Popconfirm>
          <Popconfirm
            title="要求修改该 PR？将附带上方的评论/说明内容"
            okText="确定"
            cancelText="取消"
            onConfirm={requestChanges}
          >
            {/* 同上：Tooltip 最内层 + 禁用由 span 承接 hover */}
            <Tooltip
              title={
                acting
                  ? '上一个操作进行中：完成后才能要求修改'
                  : '要求修改该 PR：确认后把上方输入的内容作为 review 说明一并提交'
              }
            >
              <span style={{ display: 'inline-flex' }}>
                <Button data-testid="github-request-changes" disabled={acting}>
                  Request changes
                </Button>
              </span>
            </Tooltip>
          </Popconfirm>
          {/* 打开合并确认弹窗（可选 merge/squash/rebase），不是直接合并 → 文案点明后续还有一步确认 */}
          <Tooltip
            title={
              acting
                ? '上一个操作进行中：完成后才能合并'
                : '合并该 PR：打开合并确认弹窗，可选择 merge / squash / rebase'
            }
          >
            <span style={{ display: 'inline-flex' }}>
              <Button data-testid="github-merge" disabled={acting} onClick={() => setMergeOpen(true)}>
                合并
              </Button>
            </span>
          </Tooltip>
          <Tooltip
            title={
              acting
                ? '上一个操作进行中：完成后才能检出'
                : '检出该 PR 的源分支：切换到本地工作区当前分支'
            }
          >
            <span style={{ display: 'inline-flex' }}>
              <Button data-testid="github-checkout" disabled={acting} onClick={onCheckout}>
                检出 PR 分支
              </Button>
            </span>
          </Tooltip>
        </Flex>
      </Flex>
      <Tabs
        defaultActiveKey="timeline"
        items={[
          {
            key: 'timeline',
            // Tabs 标签也是数据对象（items[].label）：包 Tooltip > span 逐页说明，标签样式不受影响
            label: <Tooltip title="按时间查看该 PR 的动态：评论、提交与状态变更依次排列"><span>时间线</span></Tooltip>,
            children:
              timeline === null || timeline.entries.length === 0 ? (
                <EmptyState title="暂无动态" />
              ) : (
                <Flex vertical>
                  {timeline.entries.map((entry) => (
                    <TimelineRow key={`${entry.kind}-${entry.id}`} entry={entry} />
                  ))}
                </Flex>
              ),
          },
          {
            key: 'files',
            label: <Tooltip title="查看该 PR 改动的文件清单与逐文件差异"><span>文件</span></Tooltip>,
            children:
              files === null || files.files.length === 0 ? (
                <EmptyState title="暂无文件变更" />
              ) : (
                <Flex vertical>
                  {files.files.map((file, index) => (
                    <FileRow
                      key={file.path}
                      file={file}
                      index={index}
                      loader={loader}
                      comments={(reviewComments ?? []).filter((c) => c.path === file.path)}
                      onAddReviewComment={onAddReviewComment}
                      commentActing={commentActing}
                    />
                  ))}
                </Flex>
              ),
          },
        ]}
      />
      <MergePrModal
        open={mergeOpen}
        pr={detail}
        acting={acting}
        onMerge={onMerge}
        onClose={() => setMergeOpen(false)}
      />
    </Flex>
  );
}

export function GitHubPanel(props: GitHubPanelProps): React.ReactNode {
  const {
    status,
    prs,
    number,
    detail,
    timeline,
    files,
    reviewComments,
    loading,
    acting,
    commentActing,
    loader,
    onAddReviewComment,
    onSelectPr,
    onRefresh,
    onComment,
    onReview,
    onMerge,
    onCheckout,
  } = props;

  if (!status.detected) {
    return (
      <Card size="small" data-testid="github-status-card">
        <Typography.Text>未检测到 GitHub 远程</Typography.Text>
      </Card>
    );
  }
  if (status.account === undefined) {
    return (
      <Card size="small" data-testid="github-status-card">
        <Typography.Text>未配置 GitHub 令牌，请在设置中添加</Typography.Text>
      </Card>
    );
  }

  return (
    <Flex gap={16} align="flex-start" style={{ padding: 16 }}>
      <Card
        size="small"
        title={`拉取请求（${prs.prs.length}）`}
        style={{ flex: 1, minWidth: 260 }}
        extra={
          onRefresh !== undefined ? (
            // acting 时禁用：禁用按钮不派发 hover，包一层 span 承接提示
            <Tooltip
              title={
                acting
                  ? '上一个操作进行中：完成后才能刷新'
                  : '重新拉取 PR 列表与当前详情（不改变当前选中项）'
              }
            >
              <span style={{ display: 'inline-flex' }}>
                <Button size="small" data-testid="github-refresh" disabled={acting} onClick={onRefresh}>
                  刷新
                </Button>
              </span>
            </Tooltip>
          ) : undefined
        }
      >
        {loading ? (
          <Spin data-testid="github-loading" />
        ) : prs.prs.length === 0 ? (
          <EmptyState title="暂无拉取请求" />
        ) : (
          <Flex vertical>
            {prs.prs.map((pr) => (
              // 整行气泡由 PrRow 内部持有（挂在可点 Flex 上），此处不再包一层，避免双气泡
              <PrRow key={pr.number} pr={pr} selected={pr.number === number} onSelect={onSelectPr} />
            ))}
          </Flex>
        )}
      </Card>
      {number !== null ? (
        <Card size="small" title={`PR #${number}`} style={{ flex: 2, minWidth: 380 }}>
          {detail === null ? (
            <Spin data-testid="github-detail-loading" />
          ) : (
            <PrDetailBlock
              detail={detail}
              timeline={timeline}
              files={files}
              reviewComments={reviewComments?.comments ?? null}
              acting={acting}
              commentActing={commentActing}
              loader={loader}
              onAddReviewComment={onAddReviewComment}
              onComment={onComment}
              onReview={onReview}
              onMerge={onMerge}
              onCheckout={onCheckout}
            />
          )}
        </Card>
      ) : null}
    </Flex>
  );
}
