/**
 * Diff 查看器：MonacoDiffView 包装 + 模式/呈现选项。
 * UX 对齐 #4：默认并排（side-by-side）；忽略空白（默认不忽略，对齐 Java DEFAULT）；
 * staged/工作区切换由调用方持有状态（受控组件）。
 * 呈现选项（P2 收取，#4 域「word diff/同步滚动/折叠/上下文行数」的 Web 落点——对齐 Java TextDiffSettingsHolder：
 * word diff 与同步滚动由 Monaco diff 引擎内建（行内词级高亮 + 双侧联动滚动），无需开关；
 * 「折叠」→ folding；「空白字符」→ renderWhitespace；「上下文行数」→ hideUnchangedRegions（仅变更区 + N 行上下文，
 * 对齐 Java context lines 默认 5）；ContextLineOptions 明示全部显示/0/2/5（默认）/7/15。
 *
 * 已知限制：monaco-lazy 的 effect 依赖仅 [language]，options 变化不会重建编辑器——
 * 这里用 key 随全部开关变化强制重挂载，保证 renderSideBySide/ignoreTrimWhitespace/folding 等生效。
 */
import { useState } from 'react';
import { Checkbox, Flex, Segmented, Select, Switch, Tooltip, Typography } from 'antd';
import type { FileVersions } from '@rebased/contracts';
import { MonacoDiffView, type MonacoDiffLoader } from '../base/monaco-diff-view';

export interface DiffViewerProps {
  versions: FileVersions;
  staged: boolean;
  onToggleStaged?: (staged: boolean) => void;
  ignoreWhitespace: boolean;
  onToggleWhitespace?: (ignoreWhitespace: boolean) => void;
  language?: string;
  /** from/to 定提交对比模式（true 时隐藏 staged/工作区切换——该模式与 staged 互斥，服务端 XOR 校验会给 400） */
  fromTo?: boolean;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
}

/** 上下文行数选项：'all'=全部显示（hideUnchangedRegions 关闭）；数值=仅变更区 + N 行上下文（对齐 Java context lines，默认 5） */
const CONTEXT_LINES = [
  { value: 'all' as const, label: '全部显示' },
  { value: '0' as const, label: '上下文 0 行' },
  { value: '2' as const, label: '上下文 2 行' },
  { value: '5' as const, label: '上下文 5 行' },
  { value: '7' as const, label: '上下文 7 行' },
  { value: '15' as const, label: '上下文 15 行' },
];

export function DiffViewer({
  versions,
  staged,
  onToggleStaged,
  ignoreWhitespace,
  onToggleWhitespace,
  language,
  fromTo,
  loader,
}: DiffViewerProps): React.ReactNode {
  // 默认并排（UX 对齐 #4）；呈现选项默认对齐 Java TextDiffSettingsHolder（折叠开、空白不显示、上下文 5 行）
  const [sideBySide, setSideBySide] = useState(true);
  const [folding, setFolding] = useState(true);
  const [renderWhitespace, setRenderWhitespace] = useState<'none' | 'all'>('none');
  const [contextLines, setContextLines] = useState<'all' | '0' | '2' | '5' | '7' | '15'>('5');
  const contextOptions = {
    // 'all' = 关闭隐藏未变更区（整文件全展示——Web 便捷项，Java 无对应）；数值 = 仅变更区 + N 行上下文
    ...(contextLines === 'all'
      ? {}
      : { hideUnchangedRegions: { enabled: true as const, contextLineCount: Number(contextLines) } }),
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <Flex align="center" gap={12} wrap="wrap">
        <Tooltip title="差异呈现方式：左右两栏逐行对照，或单栏里成对显示增删行">
          <Segmented
            options={[
              { label: '并排', value: 'side' },
              { label: '行内', value: 'inline' },
            ]}
            value={sideBySide ? 'side' : 'inline'}
            onChange={(v) => setSideBySide(v === 'side')}
          />
        </Tooltip>
        {/* from/to 模式：对比对象是两定提交，staged/工作区切换无意义且服务端互斥（400），隐藏 */}
        {fromTo ? null : (
          <Tooltip title="对比哪一侧的改动：未暂存的工作区改动，或已加入暂存区的内容">
            <Segmented
              options={[
                { label: '工作区', value: 'worktree' },
                { label: '已暂存', value: 'staged' },
              ]}
              value={staged ? 'staged' : 'worktree'}
              onChange={(v) => onToggleStaged?.(v === 'staged')}
            />
          </Tooltip>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="忽略空白差异：开启后缩进与行尾空白的改动不计入差异，只看实质内容变化">
            <Switch checked={ignoreWhitespace} onChange={(checked) => onToggleWhitespace?.(checked)} />
          </Tooltip>
          忽略空白
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="折叠未变更代码块：开启后长文件只展开改动附近的内容，便于快速定位">
            <Checkbox
              data-testid="diff-folding"
              checked={folding}
              onChange={(e) => setFolding(e.target.checked)}
            >
              折叠
            </Checkbox>
          </Tooltip>
        </span>
        <Tooltip title="空白字符渲染：选择是否把空格与制表符以可见符号标出（只影响显示，不改内容）">
          <Select
            data-testid="diff-whitespace"
            size="small"
            style={{ width: 130 }}
            value={renderWhitespace === 'all' ? 'all' : 'none'}
            options={[
              { value: 'none', label: '空白不显示' },
              { value: 'all', label: '空白显示' },
            ]}
            onChange={(v) => setRenderWhitespace(v === 'all' ? 'all' : 'none')}
          />
        </Tooltip>
        <Tooltip title="未变更区域的上下文行数：选「全部显示」看整文件，选数值只保留改动区附近若干行">
          <Select
            data-testid="diff-context"
            size="small"
            style={{ width: 140 }}
            value={contextLines}
            options={CONTEXT_LINES}
            onChange={setContextLines}
          />
        </Tooltip>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          word diff / 同步滚动为 Monaco 内建
        </Typography.Text>
      </Flex>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MonacoDiffView
          // monaco-lazy 不会因 options 变化重建：key 变化强制重挂载使新 options 生效
          key={`${sideBySide ? 'side' : 'inline'}-${ignoreWhitespace ? 'nowrap' : 'raw'}-${folding ? 'fold' : 'nofold'}-${renderWhitespace}-${contextLines}`}
          original={versions.before}
          modified={versions.after}
          language={language}
          options={{
            renderSideBySide: sideBySide,
            ignoreTrimWhitespace: ignoreWhitespace,
            readOnly: true,
            folding,
            renderWhitespace,
            ...contextOptions,
          }}
          loader={loader}
        />
      </div>
    </div>
  );
}
