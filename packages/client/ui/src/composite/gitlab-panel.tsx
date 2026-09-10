/**
 * GitLab 面板：左列表（iid/title/author/state 徽标/更新时间）+ 右详情（标题/元信息/reviewState 徽标/增删行统计）
 *  + tabs（时间线 | 文件）+ 操作区（评论、Approve、Request changes、合并 Modal（squash Checkbox）、检出）；
 *  「新建 MR」入口（按钮 + 源/目标分支选择+标题 Modal）在面板根列表卡片 extra（空库 0 MR 也可见）。
 *  纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入（hooks 在应用层装配）；
 *  细节：单击选中、state 直接按 state 徽标（opened 绿/merged 紫/closed 灰/locked 橙）、
 *  评论输入框与 review body 共用、REQUEST_CHANGES 带 body、diff 空串不渲染展开区、
 *  合并/新建 MR 确认即关（回调即成功语义，失败由容器处理）、刷新可选（缺省不渲染）。
 */
import { useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tabs,
  Tag,
  Typography,
  theme,
} from 'antd';
import type {
  BranchRef,
  GitLabDiscussionBody,
  GitLabDiscussionNote,
  GitLabDiscussions,
  GitLabMrCreateBody,
  GitLabMrDetail,
  GitLabMrFile,
  GitLabMrFiles,
  GitLabMrList,
  GitLabMrSummary,
  GitLabStatus,
  GitLabTimeline,
  GitLabTimelineEntry,
} from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';
import { HunkDiffView } from '../domain/hunk-diff-view';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';

/** GitLab 面板：MR 列表（iid/title/author/state 徽标）+ 详情（元信息/reviewState 徽标/增删行）+ tabs（时间线|文件）+ 操作（评论、Approve、Request changes、合并 Modal（squash Checkbox）、检出、刷新）；「新建 MR」入口在面板根列表卡片 extra */
export interface GitLabPanelProps {
  status: GitLabStatus;
  mrs: GitLabMrList; iid: number | null;
  detail: GitLabMrDetail | null; timeline: GitLabTimeline | null; files: GitLabMrFiles | null;
  branches: BranchRef[];
  /** 行级讨论注记（MR 全量，纯展示/线程挂靠由 ui 按 newPath 过滤）；null 视同无 */
  discussions?: GitLabDiscussions | null;
  loading?: boolean; acting?: boolean;
  /** 添加行级讨论进行中 */
  commentActing?: boolean;
  /** 添加行级讨论回调（容器接 useAddGitlabDiscussion） */
  onAddDiscussion?: (body: GitLabDiscussionBody) => void;
  /** 测试注入点：行级差异视图的 Monaco 加载器（缺省懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
  onSelectMr: (iid: number) => void;
  /** 刷新列表/详情：缺省不渲染刷新按钮 */
  onRefresh?: () => void;
  onCreateMr: (body: GitLabMrCreateBody) => void;
  onComment: (body: string) => void; onReview: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) => void;
  onMerge: (squash: boolean) => void; onCheckout: () => void;
}

/** MR state → 徽标配色：opened 绿 / merged 紫 / closed 灰 / locked 橙 */
const MR_STATE_COLORS: Record<GitLabMrSummary['state'], string> = {
  opened: 'success',
  merged: 'purple',
  closed: 'default',
  locked: 'orange',
};

/** reviewState → 徽标配色：APPROVED 绿 / CHANGES_REQUESTED 橙 / REVIEW_REQUIRED 红；NONE 不渲染徽标 */
const REVIEW_STATE_COLORS: Record<GitLabMrDetail['reviewState'], string> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  REVIEW_REQUIRED: 'error',
  NONE: 'default',
};

/** 时间线 review 决定 → 徽标配色（APPROVED 绿 / CHANGES_REQUESTED 橙 / COMMENTED 灰） */
const TIMELINE_REVIEW_COLORS: Record<NonNullable<GitLabTimelineEntry['reviewState']>, string> = {
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  COMMENTED: 'default',
};

/** 文件 status → 徽标配色：added 绿 / modified 蓝 / removed 红 / renamed 紫 */
const FILE_STATUS_COLORS: Record<GitLabMrFile['status'], string> = {
  added: 'green',
  modified: 'blue',
  removed: 'red',
  renamed: 'purple',
};

/** MR 列表行：iid/title/author/state 徽标 + 更新时间；整行单击 → onSelectMr；命中选择高亮 */
function MrRow({
  mr,
  selected,
  onSelect,
}: {
  mr: GitLabMrSummary;
  selected: boolean;
  onSelect: (iid: number) => void;
}): React.ReactNode {
  // 选中底色走主题 token（明亮 #e6f4ff / 暗色 #111a2c），不再硬编码明亮专用色
  const { token } = theme.useToken();
  return (
    <Flex
      data-testid={`gitlab-mr-row-${mr.iid}`}
      align="center"
      gap={8}
      style={{
        padding: '4px 8px',
        cursor: 'pointer',
        backgroundColor: selected ? token.controlItemBgActive : undefined,
      }}
      onClick={() => onSelect(mr.iid)}
    >
      <Tag style={{ flexShrink: 0 }}>{`#${mr.iid}`}</Tag>
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {mr.title}
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {mr.author}
      </Typography.Text>
      <Tag color={MR_STATE_COLORS[mr.state]} style={{ flexShrink: 0 }}>
        {mr.state}
      </Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
        {formatCommitDate(mr.updatedAtIso)}
      </Typography.Text>
    </Flex>
  );
}

/** 时间线条目：kind 徽标（comment 评论/review 审查+reviewState）+ author + 时间 + body（保留换行） */
function TimelineRow({ entry }: { entry: GitLabTimelineEntry }): React.ReactNode {
  return (
    <Flex vertical data-testid={`gitlab-timeline-${entry.id}`} style={{ padding: '4px 0' }}>
      <Flex align="center" gap={8}>
        <Tag color={entry.kind === 'review' ? 'blue' : 'default'} style={{ flexShrink: 0 }}>
          {entry.kind === 'review' ? '审查' : '评论'}
        </Tag>
        {entry.reviewState ? (
          <Tag color={TIMELINE_REVIEW_COLORS[entry.reviewState]} style={{ flexShrink: 0 }}>
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

/** 文件行：path/status 徽标/增删行 + 「查看差异」展开区（行级视图：逐 hunk 两侧 MonacoDiffView + 行级讨论线程，2026-09-08 裁定 §2.7）；
 *  diff 空串时仅 renamed（无内容变更）与 removed（二进制/截断）渲染展开——由 HunkDiffView 降级提示 */
function FileRow({
  file,
  index,
  notes,
  onAddDiscussion,
  commentActing,
  loader,
}: {
  file: GitLabMrFile;
  index: number;
  /** 该文件的行级讨论注记（容器已按 newPath 过滤；newLine=null 的无锚点条目在此丢弃） */
  notes: GitLabDiscussionNote[];
  onAddDiscussion?: (body: GitLabDiscussionBody) => void;
  commentActing?: boolean;
  loader?: MonacoDiffLoader;
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false);

  return (
    <Flex vertical data-testid={`gitlab-file-${index}`} style={{ padding: '4px 0' }}>
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
      {file.diff !== '' || file.status === 'renamed' ? (
        <Flex vertical gap={4}>
          <Button
            type="link"
            size="small"
            data-testid={`gitlab-diff-toggle-${index}`}
            style={{ alignSelf: 'flex-start', padding: 0 }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起差异' : '查看差异'}
          </Button>
          {expanded ? (
            <HunkDiffView
              patch={file.diff}
              status={file.status}
              loader={loader}
              comments={notes
                .filter((n) => n.newLine !== null)
                .map((n) => ({ id: String(n.id), line: n.newLine as number, author: n.author, atIso: n.atIso, body: n.body }))}
              adding={commentActing}
              onAddComment={(line, body) => onAddDiscussion?.({ path: file.path, line, body })}
            />
          ) : null}
        </Flex>
      ) : null}
    </Flex>
  );
}

/** 合并 MR Modal：squash Checkbox（默认不勾选，GitLab 项目可配置默认，仅传参）；确认调 onMerge；关闭时复位 */
function MergeMrModal({
  open,
  iid,
  acting,
  onMerge,
  onClose,
}: {
  open: boolean;
  iid: number;
  acting?: boolean;
  onMerge: (squash: boolean) => void;
  onClose: () => void;
}): React.ReactNode {
  const [squash, setSquash] = useState(false);

  /** 关闭时复位（Modal 默认不卸载子树，取消后重开不能残留上次选择） */
  const close = (): void => {
    setSquash(false);
    onClose();
  };

  const submit = (): void => {
    onMerge(squash);
    close();
  };

  return (
    <Modal
      title={`合并 MR #${iid}`}
      open={open}
      okText="确定"
      cancelText="取消"
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">合并后 MR 将在 GitLab 上标记为已合并。</Typography.Text>
        <Checkbox checked={squash} onChange={(e) => setSquash(e.target.checked)}>
          squash：压缩为单个提交
        </Checkbox>
      </Flex>
    </Modal>
  );
}

/** 新建 MR Modal：源分支 Select + 目标分支 Select + 标题 Input（maxLength 255，showCount）+ 描述 TextArea（可选，maxLength 20000）；校验源≠目标且标题非空；确认调 onCreateMr；关闭时复位 */
function CreateMrModal({
  open,
  branches,
  acting,
  onCreateMr,
  onClose,
}: {
  open: boolean;
  branches: BranchRef[];
  acting?: boolean;
  onCreateMr: (body: GitLabMrCreateBody) => void;
  onClose: () => void;
}): React.ReactNode {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const options = branches.map((b) => ({ value: b.name, label: b.name }));
  /** 源≠目标且标题非空（trim 后）才可提交 */
  const sameBranch = source !== '' && target !== '' && source === target;
  const valid = !sameBranch && source !== '' && target !== '' && title.trim() !== '';

  /** 关闭时复位全部输入：Modal 默认不卸载子树，取消后重开不能残留上次输入 */
  const close = (): void => {
    setSource('');
    setTarget('');
    setTitle('');
    setDescription('');
    onClose();
  };

  /** 提交并复位：描述仅在非空时携带（契约 description 为 optional） */
  const submit = (): void => {
    const desc = description.trim();
    onCreateMr({
      sourceBranch: source,
      targetBranch: target,
      title: title.trim(),
      ...(desc === '' ? {} : { description: desc }),
    });
    close();
  };

  return (
    <Modal
      title="新建合并请求"
      open={open}
      okText="确定"
      cancelText="取消"
      okButtonProps={{ disabled: !valid }}
      confirmLoading={acting}
      onOk={submit}
      onCancel={close}
    >
      <Flex vertical gap={8}>
        <Select
          data-testid="gitlab-create-source"
          placeholder="源分支"
          value={source === '' ? undefined : source}
          options={options}
          onChange={setSource}
        />
        <Select
          data-testid="gitlab-create-target"
          placeholder="目标分支"
          value={target === '' ? undefined : target}
          options={options}
          onChange={setTarget}
        />
        {sameBranch ? (
          <Typography.Text type="warning">源分支与目标分支不能相同</Typography.Text>
        ) : null}
        <Input
          data-testid="gitlab-create-title"
          placeholder="标题"
          value={title}
          maxLength={255}
          showCount
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input.TextArea
          data-testid="gitlab-create-description"
          rows={3}
          placeholder="描述（可选）"
          value={description}
          maxLength={20_000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flex>
    </Modal>
  );
}

/** 详情块（detail 非空时渲染）：标题/元信息/主体 + 操作区（评论输入框共用 review body）+ tabs（时间线 | 文件） */
function MrDetailBlock({
  detail,
  timeline,
  files,
  notes,
  acting,
  commentActing,
  loader,
  onAddDiscussion,
  onComment,
  onReview,
  onMerge,
  onCheckout,
}: {
  detail: GitLabMrDetail;
  timeline: GitLabTimeline | null;
  files: GitLabMrFiles | null;
  /** 行级讨论注记（全量文件混合）；FileRow 内按 newPath 过滤 */
  notes: GitLabDiscussionNote[] | null;
  acting?: boolean;
  /** 添加行级讨论进行中：hunk 线程发送按钮 loading */
  commentActing?: boolean;
  /** 测试注入点：行级差异视图的 Monaco 加载器（缺省懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
  /** 添加行级讨论回调（path + line + body 由 ui 组装，容器接 hook） */
  onAddDiscussion?: (body: GitLabDiscussionBody) => void;
  onComment: (body: string) => void;
  onReview: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) => void;
  onMerge: (squash: boolean) => void;
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
      <Typography.Title level={5} style={{ margin: 0 }} data-testid="gitlab-detail-title">
        {detail.title}
      </Typography.Title>
      <Flex align="center" gap={12} wrap>
        <Typography.Text type="secondary" data-testid="gitlab-detail-author">
          {detail.author}
        </Typography.Text>
        <Typography.Text type="secondary" data-testid="gitlab-detail-iid">{`#${detail.iid}`}</Typography.Text>
        <Typography.Text type="secondary" data-testid="gitlab-detail-refs">
          {detail.sourceBranch} → {detail.targetBranch}
        </Typography.Text>
        {detail.reviewState !== 'NONE' ? (
          <Tag color={REVIEW_STATE_COLORS[detail.reviewState]} data-testid="gitlab-review-state">
            {detail.reviewState}
          </Tag>
        ) : null}
        <Typography.Text type="success" data-testid="gitlab-additions">{`+${detail.additions}`}</Typography.Text>
        <Typography.Text type="danger" data-testid="gitlab-deletions">{`-${detail.deletions}`}</Typography.Text>
      </Flex>
      <Typography.Paragraph data-testid="gitlab-body" style={{ whiteSpace: 'pre-wrap' }}>
        {detail.body}
      </Typography.Paragraph>
      <Flex vertical gap={8}>
        <Input.TextArea
          data-testid="gitlab-comment-input"
          rows={3}
          placeholder="评论或 review 说明"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Flex gap={8} wrap>
          <Button
            type="primary"
            data-testid="gitlab-send-comment"
            disabled={acting || comment.trim() === ''}
            onClick={sendComment}
          >
            发送评论
          </Button>
          <Popconfirm
            title="批准该 MR？"
            okText="确定"
            cancelText="取消"
            onConfirm={() => onReview('APPROVE')}
          >
            <Button data-testid="gitlab-approve" disabled={acting}>
              Approve
            </Button>
          </Popconfirm>
          <Popconfirm
            title="要求修改该 MR？将附带上方的评论/说明内容"
            okText="确定"
            cancelText="取消"
            onConfirm={requestChanges}
          >
            <Button data-testid="gitlab-request-changes" disabled={acting}>
              Request changes
            </Button>
          </Popconfirm>
          <Button data-testid="gitlab-merge" disabled={acting} onClick={() => setMergeOpen(true)}>
            合并
          </Button>
          <Button data-testid="gitlab-checkout" disabled={acting} onClick={onCheckout}>
            检出 MR 分支
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
                    <TimelineRow key={`${entry.kind}-${entry.id}`} entry={entry} />
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
                    <FileRow
                      key={file.path}
                      file={file}
                      index={index}
                      loader={loader}
                      notes={(notes ?? []).filter((n) => n.newPath === file.path)}
                      onAddDiscussion={onAddDiscussion}
                      commentActing={commentActing}
                    />
                  ))}
                </Flex>
              ),
          },
        ]}
      />
      <MergeMrModal
        open={mergeOpen}
        iid={detail.iid}
        acting={acting}
        onMerge={onMerge}
        onClose={() => setMergeOpen(false)}
      />
    </Flex>
  );
}

export function GitLabPanel(props: GitLabPanelProps): React.ReactNode {
  const [createOpen, setCreateOpen] = useState(false);
  const {
    status,
    mrs,
    iid,
    detail,
    timeline,
    files,
    branches,
    loading,
    acting,
    discussions,
    commentActing,
    loader,
    onAddDiscussion,
    onSelectMr,
    onRefresh,
    onCreateMr,
    onComment,
    onReview,
    onMerge,
    onCheckout,
  } = props;

  if (!status.detected) {
    return (
      <Card size="small" data-testid="gitlab-status-card">
        <Typography.Text>未检测到 GitLab 远程</Typography.Text>
      </Card>
    );
  }
  if (status.account === undefined) {
    return (
      <Card size="small" data-testid="gitlab-status-card">
        <Typography.Text>未配置 GitLab 令牌，请在设置中添加</Typography.Text>
      </Card>
    );
  }

  return (
    <Flex gap={16} align="flex-start" style={{ padding: 16 }}>
      <Card
        size="small"
        title={`合并请求（${mrs.mrs.length}）`}
        style={{ flex: 1, minWidth: 260 }}
        extra={
          <Flex gap={8}>
            {onRefresh !== undefined ? (
              <Button size="small" data-testid="gitlab-refresh" disabled={acting} onClick={onRefresh}>
                刷新
              </Button>
            ) : null}
            <Button
              size="small"
              data-testid="gitlab-create-mr"
              disabled={acting}
              onClick={() => setCreateOpen(true)}
            >
              新建 MR
            </Button>
          </Flex>
        }
      >
        {loading ? (
          <Spin data-testid="gitlab-loading" />
        ) : mrs.mrs.length === 0 ? (
          <EmptyState title="暂无合并请求" />
        ) : (
          <Flex vertical>
            {mrs.mrs.map((mr) => (
              <MrRow key={mr.iid} mr={mr} selected={mr.iid === iid} onSelect={onSelectMr} />
            ))}
          </Flex>
        )}
      </Card>
      {iid !== null ? (
        <Card size="small" title={`MR #${iid}`} style={{ flex: 2, minWidth: 380 }}>
          {detail === null ? (
            <Spin data-testid="gitlab-detail-loading" />
          ) : (
            <MrDetailBlock
              detail={detail}
              timeline={timeline}
              files={files}
              notes={discussions?.notes ?? null}
              acting={acting}
              commentActing={commentActing}
              loader={loader}
              onAddDiscussion={onAddDiscussion}
              onComment={onComment}
              onReview={onReview}
              onMerge={onMerge}
              onCheckout={onCheckout}
            />
          )}
        </Card>
      ) : null}
      <CreateMrModal
        open={createOpen}
        branches={branches}
        acting={acting}
        onCreateMr={onCreateMr}
        onClose={() => setCreateOpen(false)}
      />
    </Flex>
  );
}
