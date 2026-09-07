/**
 * 行级差异视图（GitHub/GitLab 共用）：单文件 unified diff → 逐 hunk 两侧 MonacoDiffEditor。
 * 统一来自 contracts `parseUnifiedDiff`（@@ 头算术行映射——评论区锚点与行号显示同源）；
 * 每 hunk 一个块（头行「@@ -a,b +c,d @@ 标题」+ MonacoDiffView 只读），块高按行数自适应（上限 320）。
 * 降级路径：0 hunk → 按 status 提示（renamed=仅重命名；其余=二进制/超限截断）；
 * 大 diff 截断（GitHub 无标记）按部分渲染——解析出多少 hunk 显示多少。
 * 纯函数驱动（ui 不调接口）；loader 为测试注入点。
 */
import { Typography } from 'antd';
import { parseUnifiedDiff, hunkSides } from '@rebased/contracts';
import { MonacoDiffView, type MonacoDiffLoader } from '../base/monaco-diff-view';

export interface HunkDiffViewProps {
  /** 单文件 unified diff 全文（GitHub patch / GitLab diff 字段） */
  patch: string;
  /** 文件状态（added/modified/removed/renamed）：0 hunk 时决定降级提示 */
  status: string;
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

export function HunkDiffView({ patch, status, loader }: HunkDiffViewProps): React.ReactNode {
  const hunks = parseUnifiedDiff(patch);
  if (hunks.length === 0) return <DegradedHint status={status} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hunks.map((hunk, hi) => {
        const { before, after } = hunkSides(hunk);
        // 块高自适应：全量行数（上下文行计双侧最大值）×行高（约 19px）+ 余量，上限 320
        const lineCount = Math.max(
          hunk.lines.filter((l) => l.kind !== 'add').length,
          hunk.lines.filter((l) => l.kind !== 'remove').length,
        );
        return (
          <div key={hi} data-testid={`hunk-diff-block-${hi}`}>
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
          </div>
        );
      })}
    </div>
  );
}
