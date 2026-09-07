/**
 * Monaco 单编辑器懒加载基础组件（普通模式包装）。
 * 与 MonacoDiffView 同手法：loader 注入点默认懒加载真实 monaco-lazy，测试注入 stub 绕过。
 * 用于只读文本视图（如 diff 流式补丁文本渐进渲染——language 'diff' 高亮 +- 行）。
 */
import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import type { MonacoEditorInnerProps, MonacoLazyLoader } from './monaco-lazy';

export type MonacoTextViewProps = MonacoEditorInnerProps & { loader?: MonacoLazyLoader };

const defaultLoader: MonacoLazyLoader = () => import('./monaco-lazy');

export function MonacoTextView({ loader = defaultLoader, ...inner }: MonacoTextViewProps): ReactNode {
  // 按 loader 实例缓存 lazy 组件，避免每次渲染重置加载状态
  const LazyEditor = useMemo(() => lazy(loader), [loader]);
  return (
    <Suspense fallback={<div>加载中…</div>}>
      <LazyEditor {...inner} />
    </Suspense>
  );
}
