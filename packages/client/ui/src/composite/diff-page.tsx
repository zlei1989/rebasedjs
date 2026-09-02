/**
 * 差异页：文件路径头 + DiffViewer（默认并排、忽略空白开关默认不忽略、staged/工作区切换）。
 * UX 对齐 #4。ignoreWhitespace 为页面内部状态（默认 false，对齐 Java DEFAULT），切换时通知调用方；
 * staged 由调用方受控（影响服务端取数三态映射）。
 */
import { useState } from 'react';
import type { FileVersions } from '@rebased/contracts';
import { DiffViewer } from '../domain/diff-viewer';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';

export interface DiffPageProps {
  versions: FileVersions;
  /** 当前对比文件路径（页头展示） */
  file: string;
  staged: boolean;
  onToggleStaged?: (staged: boolean) => void;
  onToggleWhitespace?: (ignoreWhitespace: boolean) => void;
  language?: string;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
}

export function DiffPage({
  versions,
  file,
  staged,
  onToggleStaged,
  onToggleWhitespace,
  language,
  loader,
}: DiffPageProps): React.ReactNode {
  // 忽略空白默认关（UX 对齐 #4：对齐 Java TextDiffSettingsHolder 默认不忽略）
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', padding: 8 }}>
      <div style={{ fontWeight: 600 }}>{file}</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffViewer
          versions={versions}
          staged={staged}
          onToggleStaged={onToggleStaged}
          ignoreWhitespace={ignoreWhitespace}
          onToggleWhitespace={(v) => {
            setIgnoreWhitespace(v);
            onToggleWhitespace?.(v);
          }}
          language={language}
          loader={loader}
        />
      </div>
    </div>
  );
}
