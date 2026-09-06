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
  Typography,
} from 'antd';
import type {
  GitHubPrDetail,
  GitHubPrFile,
  GitHubPrFiles,
  GitHubPrList,
  GitHubPrSummary,
  GitHubStatus,
  GitHubTimeline,
  GitHubTimelineEntry,
} from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

/** GitHub 面板：左列表（number/title/author/state 徽标/更新时间）+ 右详情（标题/主体/元信息/reviewDecision 徽标/增删行统计）+ tabs（时间线 | 文件）+ 操作区（评论、Approve、Request changes、合并 Modal、检出、刷新） */
export interface GitHubPanelProps {
  status: GitHubStatus;
  prs: GitHubPrList; number: number | null;
  detail: GitHubPrDetail | null; timeline: GitHubTimeline | null; files: GitHubPrFiles | null;
  loading?: boolean; acting?: boolean;
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
  return (
    <Flex
      data-testid={`github-pr-row-${pr.number}`}
      align="center"
      gap={8}
      style={{
        padding: '4px 8px',
        cursor: 'pointer',
        backgroundColor: selected ? '#e6f4ff' : undefined,
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

/** 文件行：path/status 徽标/增删行 + 「查看补丁」展开区（patch 空串不渲染展开） */
function FileRow({ file, index }: { file: GitHubPrFile; index: number }): React.ReactNode {
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
      {file.patch !== '' ? (
        <Flex vertical gap={4}>
          <Button
            type="link"
            size="small"
            data-testid={`github-patch-toggle-${index}`}
            style={{ alignSelf: 'flex-start', padding: 0 }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起补丁' : '查看补丁'}
          </Button>
          {expanded ? (
            <pre
              data-testid={`github-patch-${index}`}
              style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}
            >
              {file.patch}
            </pre>
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
        <Radio.Group
          value={method}
          onChange={(e) => setMethod(e.target.value as 'merge' | 'squash' | 'rebase')}
        >
          <Flex vertical gap={4}>
            {MERGE_METHODS.map((m) => (
              <Radio key={m.value} value={m.value}>
                {m.label}
              </Radio>
            ))}
          </Flex>
        </Radio.Group>
      </Flex>
    </Modal>
  );
}

/** 详情块（detail 非空时渲染）：标题/元信息/主体 + 操作区（评论输入框共用 review body）+ tabs（时间线 | 文件） */
function PrDetailBlock({
  detail,
  timeline,
  files,
  acting,
  onComment,
  onReview,
  onMerge,
  onCheckout,
}: {
  detail: GitHubPrDetail;
  timeline: GitHubTimeline | null;
  files: GitHubPrFiles | null;
  acting?: boolean;
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
        <Input.TextArea
          data-testid="github-comment-input"
          rows={3}
          placeholder="评论或 review 说明"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Flex gap={8} wrap>
          <Button
            type="primary"
            data-testid="github-send-comment"
            disabled={acting || comment.trim() === ''}
            onClick={sendComment}
          >
            发送评论
          </Button>
          <Popconfirm
            title="批准该 PR？"
            okText="确定"
            cancelText="取消"
            onConfirm={() => onReview('APPROVE')}
          >
            <Button data-testid="github-approve" disabled={acting}>
              Approve
            </Button>
          </Popconfirm>
          <Popconfirm
            title="要求修改该 PR？将附带上方的评论/说明内容"
            okText="确定"
            cancelText="取消"
            onConfirm={requestChanges}
          >
            <Button data-testid="github-request-changes" disabled={acting}>
              Request changes
            </Button>
          </Popconfirm>
          <Button data-testid="github-merge" disabled={acting} onClick={() => setMergeOpen(true)}>
            合并
          </Button>
          <Button data-testid="github-checkout" disabled={acting} onClick={onCheckout}>
            检出 PR 分支
          </Button>
        </Flex>
      </Flex>
      <Tabs
        defaultActiveKey="timeline"
        items={[
          {
            key: 'timeline',
            label: '时间线',
            children:
              timeline === null || timeline.entries.length === 0 ? (
                <EmptyState title="暂无动态" />
              ) : (
                <Flex vertical>
                  {timeline.entries.map((entry) => (
                    <TimelineRow key={entry.id} entry={entry} />
                  ))}
                </Flex>
              ),
          },
          {
            key: 'files',
            label: '文件',
            children:
              files === null || files.files.length === 0 ? (
                <EmptyState title="暂无文件变更" />
              ) : (
                <Flex vertical>
                  {files.files.map((file, index) => (
                    <FileRow key={file.path} file={file} index={index} />
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
    loading,
    acting,
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
            <Button size="small" data-testid="github-refresh" disabled={acting} onClick={onRefresh}>
              刷新
            </Button>
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
              acting={acting}
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
