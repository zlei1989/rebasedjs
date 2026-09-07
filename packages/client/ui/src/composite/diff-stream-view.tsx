/**
 * diff 分块流式视图：把 diff/stream 累积的 unified 补丁文本渐进渲染到 Monaco 只读编辑器。
 * 与全文 DiffViewer 的关系（Ruling 6）：流是同一查询的渐进渲染——全文到达前本视图先呈现当前进度，
 * 全文（FileVersions）到达后容器切换标准并排/行内视图；本视图不替代全文路径（spec §4.4「UI 走全文路径」）。
 * language 默认 'diff'（monaco 内建基础语言，行级 +-/空格着色），readOnly 由调用方语义固定为 true。
 * 纯受控（text/error 由容器注入 useDiffStream 结果）；loader 为测试注入点。
 */
import { Typography } from 'antd';
import { MonacoTextView, type MonacoTextViewProps } from '../base/monaco-text-view';
import type { MonacoLazyLoader } from '../base/monaco-lazy';

export interface DiffStreamViewProps {
  /** 截至当前累积的补丁文本（逐步追加） */
  text: string;
  /** 流错误（stream.error 帧或断流错误）；非空时优先展示 */
  error?: string | null;
  /** 流订阅存活（未连接且无错误 → 占位提示） */
  connected?: boolean;
  loader?: MonacoLazyLoader;
  /** 注入给 MonacoTextView 的其他 props（测试断言用） */
  textViewProps?: Omit<MonacoTextViewProps, 'value' | 'loader'>;
}

export function DiffStreamView({
  text,
  error,
  connected = true,
  loader,
  textViewProps,
}: DiffStreamViewProps): React.ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', padding: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {error === undefined || error === null
          ? connected
            ? '分块加载中…（渲染截至当前进度）'
            : '分块加载中断'
          : '分块加载失败'}
      </Typography.Text>
      {error === undefined || error === null ? null : (
        <Typography.Text type="danger" data-testid="diff-stream-error">
          {error}
        </Typography.Text>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MonacoTextView
          value={text}
          language="diff"
          readOnly
          options={{ minimap: { enabled: false }, readOnly: true }}
          {...textViewProps}
          loader={loader}
        />
      </div>
    </div>
  );
}
