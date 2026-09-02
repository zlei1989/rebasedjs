/**
 * Monaco 差异编辑器视图：懒加载 monaco-editor，避免首屏打包/加载整包。
 * 做法：React.lazy 包裹真正的编辑器模块（./monaco-lazy），Suspense fallback
 * 为加载占位；loader 为依赖注入点，测试可注入 mock 模块绕过真实 monaco。
 */
import { lazy, Suspense, useMemo, type ComponentType, type ReactNode } from 'react';
import type * as monaco from 'monaco-editor';

/** 内部编辑器组件（monaco-lazy 默认导出）接收的 props */
export interface MonacoDiffInnerProps {
  original: string;
  modified: string;
  language?: string;
  options?: monaco.editor.IStandaloneDiffEditorConstructionOptions;
}

/** loader 注入点：返回带默认导出编辑器组件的模块（默认动态 import ./monaco-lazy） */
export type MonacoDiffLoader = () => Promise<{ default: ComponentType<MonacoDiffInnerProps> }>;

export interface MonacoDiffViewProps extends MonacoDiffInnerProps {
  loader?: MonacoDiffLoader;
}

const defaultLoader: MonacoDiffLoader = () => import('./monaco-lazy');

export function MonacoDiffView({ loader = defaultLoader, ...inner }: MonacoDiffViewProps): ReactNode {
  // 按 loader 实例缓存 lazy 组件，避免每次渲染重置加载状态
  const LazyDiff = useMemo(() => lazy(loader), [loader]);
  return (
    <Suspense fallback={<div>加载中…</div>}>
      <LazyDiff {...inner} />
    </Suspense>
  );
}
