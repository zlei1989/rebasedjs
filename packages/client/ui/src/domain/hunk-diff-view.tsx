/**
 * 行级差异视图（GitHub/GitLab 共用）：单文件 unified diff → 逐 hunk 两侧 MonacoDiffEditor + 行级评论线程。
 * 统一来自 contracts `parseUnifiedDiff`（@@ 头算术行映射——评论区锚点与行号显示同源）；
 * 每 hunk 一个块（头行「@@ -a,b +c,d @@ 标题」+ MonacoDiffView 只读 + 该 hunk 新侧范围内的评论线程
 * + 添加行：新侧行号 Select（afterStart..afterStart+afterCount-1）+ 输入 + 发送）。
 * 降级路径：0 hunk → 按 status 提示（renamed=仅重命名；其余=二进制/超限截断）；
 * 大 diff 截断（GitHub 无标记）按部分渲染——解析出多少 hunk 显示多少。
 * 纯函数驱动（ui 不调接口）；loader 为测试注入点。
 */
import { Button, Flex, Input, Select, Tooltip, Typography } from 'antd';
import { parseUnifiedDiff, hunkSides, type UnifiedHunk } from '@rebased/contracts';
import { useState } from 'react';
import { formatCommitDate } from './format';
import { MonacoDiffView, type MonacoDiffLoader } from '../base/monaco-diff-view';

/** 行级评论（新侧锚定）：line 为新侧文件行号；atIso 为 ISO 日期串（formatCommitDate 直接截取） */
export interface HunkComment {
  id: string;
  line: number;
  author: string;
  atIso: string;
  body: string;
}

export interface HunkDiffViewProps {
  /** 单文件 unified diff 全文（GitHub patch / GitLab diff 字段） */
  patch: string;
  /** 文件状态（added/modified/removed/renamed）：0 hunk 时决定降级提示 */
  status: string;
  /** 该文件的行级评论（新侧锚定）：按 hunk 新侧行号范围挂靠渲染 */
  comments?: HunkComment[];
  /** 添加评论回调（line 为新侧文件行号，body 为输入内容）；提供时每个 hunk 块渲染添加行 */
  onAddComment?: (line: number, body: string) => void;
  /** 添加进行中：发送按钮 loading */
  adding?: boolean;
  loader?: MonacoDiffLoader;
}

/** 降级提示（0 hunk 时按状态分流） */
function DegradedHint({ status }: { status: string }): React.ReactNode {
  return (
    <Typography.Text type="secondary" data-testid="hunk-diff-degraded">
      {status === 'renamed'
        ? '该文件仅重命名（无内容变更）'
        : '无可用的行级差异（二进制文件或超限截断）'}
    </Typography.Text>
  );
}

/** 单 hunk 块：头行 + MonacoDiffView + 评论线程 + 添加行 */
function HunkBlock({
  hunk,
  index,
  comments,
  adding,
  onAddComment,
  loader,
}: {
  hunk: UnifiedHunk;
  index: number;
  comments: HunkComment[];
  adding?: boolean;
  onAddComment?: (line: number, body: string) => void;
  loader?: MonacoDiffLoader;
}): React.ReactNode {
  const [selectedLine, setSelectedLine] = useState(hunk.afterStart);
  const [draft, setDraft] = useState('');
  const { before, after } = hunkSides(hunk);
  // 块高自适应：全量行数（上下文行计双侧最大值）×行高（约 19px）+ 余量，上限 320
  const lineCount = Math.max(
    hunk.lines.filter((l) => l.kind !== 'add').length,
    hunk.lines.filter((l) => l.kind !== 'remove').length,
  );
  // 新侧行号区间（afterCount=0 时为空——删除文件无新侧行可锚定）
  const rightLines = Array.from({ length: hunk.afterCount }, (_, i) => hunk.afterStart + i);
  /** 提交：去空白非空才触发，并清空输入（行号保持上次选择——同 hunk 连续评论常见场景） */
  const submit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    onAddComment?.(selectedLine, trimmed);
    setDraft('');
  };
  return (
    <div data-testid={`hunk-diff-block-${index}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Typography.Text code style={{ fontSize: 12 }}>
          @@ -{hunk.beforeStart},{hunk.beforeCount} +{hunk.afterStart},{hunk.afterCount} @@
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
          {hunk.heading}
        </Typography.Text>
      </div>
      <div style={{ height: Math.min(320, Math.max(lineCount * 19 + 20, 80)) }}>
        <MonacoDiffView original={before} modified={after} options={{ readOnly: true }} loader={loader} />
      </div>
      <Flex vertical gap={8} style={{ marginTop: 8 }}>
        {comments.map((comment) => (
          <Flex vertical key={comment.id} data-testid={`hunk-comment-${comment.id}`} gap={2}>
            <Flex align="center" gap={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                新侧 {comment.line} 行 · {comment.author} · {formatCommitDate(comment.atIso)}
              </Typography.Text>
            </Flex>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{comment.body}</Typography.Paragraph>
          </Flex>
        ))}
        {onAddComment !== undefined && rightLines.length > 0 ? (
          <Flex align="center" gap={8}>
            <Tooltip title="评论锚定的新文件行号：只列本 hunk 新侧的行，选中即决定评论挂在哪一行">
              <Select
                data-testid={`hunk-comment-line-${index}`}
                size="small"
                style={{ width: 120 }}
                value={selectedLine}
                options={rightLines.map((line) => ({ value: line, label: `第 ${line} 行` }))}
                onChange={setSelectedLine}
              />
            </Tooltip>
            <Tooltip title="行级评论内容：回车或点「发送」提交，提交后输入框清空、行号保持上次选择">
              <Input
                data-testid={`hunk-comment-input-${index}`}
                size="small"
                placeholder="行级评论"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPressEnter={submit}
              />
            </Tooltip>
            {/* 评论为空时按钮禁用；antd 禁用按钮不派发 hover，故在 Tooltip 与 Button 之间包一层 span 承接悬停提示 */}
            <Tooltip title={draft.trim() === '' ? '先填写评论内容：内容为空时无法发送' : '把这条评论发到所选行，随代码评审一起保存'}>
              <span>
                <Button
                  size="small"
                  data-testid={`hunk-comment-send-${index}`}
                  disabled={draft.trim() === ''}
                  loading={adding}
                  onClick={submit}
                >
                  发送
                </Button>
              </span>
            </Tooltip>
          </Flex>
        ) : null}
      </Flex>
    </div>
  );
}

export function HunkDiffView({ patch, status, comments = [], onAddComment, adding, loader }: HunkDiffViewProps): React.ReactNode {
  const hunks = parseUnifiedDiff(patch);
  if (hunks.length === 0) return <DegradedHint status={status} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {hunks.map((hunk, index) => (
        <HunkBlock
          key={index}
          hunk={hunk}
          index={index}
          loader={loader}
          adding={adding}
          onAddComment={onAddComment}
          comments={comments.filter(
            (c) => c.line >= hunk.afterStart && c.line <= hunk.afterStart + hunk.afterCount - 1,
          )}
        />
      ))}
    </div>
  );
}
