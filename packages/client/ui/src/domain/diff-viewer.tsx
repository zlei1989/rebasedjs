/**
 * Diff 查看器：MonacoDiffView 包装 + 模式切换。
 * UX 对齐 #4：默认并排（side-by-side）；忽略空白开关（默认不忽略，对齐 Java DEFAULT）；
 * staged/工作区切换由调用方持有状态（受控组件）。
 *
 * 已知限制：monaco-lazy 的 effect 依赖仅 [language]，options 变化不会重建编辑器——
 * 这里用 key 随模式/空白开关变化强制重挂载，保证 renderSideBySide/ignoreTrimWhitespace 生效。
 */
import { useState } from 'react';
import { Segmented, Switch } from 'antd';
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
  // 默认并排（UX 对齐 #4）
  const [sideBySide, setSideBySide] = useState(true);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Segmented
          options={[
            { label: '并排', value: 'side' },
            { label: '行内', value: 'inline' },
          ]}
          value={sideBySide ? 'side' : 'inline'}
          onChange={(v) => setSideBySide(v === 'side')}
        />
        {/* from/to 模式：对比对象是两定提交，staged/工作区切换无意义且服务端互斥（400），隐藏 */}
        {fromTo ? null : (
          <Segmented
            options={[
              { label: '工作区', value: 'worktree' },
              { label: '已暂存', value: 'staged' },
            ]}
            value={staged ? 'staged' : 'worktree'}
            onChange={(v) => onToggleStaged?.(v === 'staged')}
          />
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Switch checked={ignoreWhitespace} onChange={(checked) => onToggleWhitespace?.(checked)} />
          忽略空白
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MonacoDiffView
          // monaco-lazy 不会因 options 变化重建：key 变化强制重挂载使新 options 生效
          key={`${sideBySide ? 'side' : 'inline'}-${ignoreWhitespace ? 'nowrap' : 'raw'}`}
          original={versions.before}
          modified={versions.after}
          language={language}
          options={{ renderSideBySide: sideBySide, ignoreTrimWhitespace: ignoreWhitespace, readOnly: true }}
          loader={loader}
        />
      </div>
    </div>
  );
}
