/**
 * 3-way 合并视图（对照平台 3-way merge + spec §4.5.2：左右 diff + 底部合并结果面板）：
 *  上排两个只读 MonacoDiffView：左 base→ours（标题"当前分支"）、右 base→theirs（标题"合并来源"）；
 *  底部可编辑 Monaco（标题"合并结果"，初始内容为 ours ?? base ?? theirs ?? ''）+ 保存按钮。
 *  base 为 null（双方新增）时上排退化为 ours/theirs 并排只读（两个 MonacoLazy 普通编辑器）。
 *  全屏 Modal 形态由调用方包裹，本组件只渲染内容区。
 *  Monaco 重：经 loader 懒加载（默认动态 import monaco-lazy），测试注入 stub loader 绕过。
 */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Flex, Typography } from 'antd';
import type { ConflictContents } from '@rebased/contracts';
import { MonacoDiffView } from '../base/monaco-diff-view';
import type { MonacoEditorInnerProps, MonacoLazyLoader } from '../base/monaco-lazy';

/** 3-way 合并视图 props（见文件头说明） */
export interface MergeViewProps {
  contents: ConflictContents;
  onSave: (path: string, content: string) => void;
  saving?: boolean;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco-lazy 模块） */
  loader?: MonacoLazyLoader;
}

const defaultLoader: MonacoLazyLoader = () => import('../base/monaco-lazy');

/** 普通模式 Monaco 懒加载包装（与 MonacoDiffView 同手法：按 loader 实例缓存 lazy 组件） */
function MonacoEditorLazy({ loader, ...inner }: MonacoEditorInnerProps & { loader: MonacoLazyLoader }): ReactNode {
  const LazyEditor = useMemo(() => lazy(loader), [loader]);
  return (
    <Suspense fallback={<div>加载中…</div>}>
      <LazyEditor {...inner} />
    </Suspense>
  );
}

/** 面板：标题行（可带右侧操作）+ 编辑器区（占满剩余高度） */
function Pane({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <Flex vertical gap={4} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <Flex justify="space-between" align="center">
        <Typography.Text strong>{title}</Typography.Text>
        {action}
      </Flex>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </Flex>
  );
}

export function MergeView({ contents, onSave, saving = false, loader = defaultLoader }: MergeViewProps): ReactNode {
  const { path, base, ours, theirs } = contents;
  // 合并结果编辑内容：初始 ours ?? base ?? theirs ?? ''；切换冲突文件时重置为新文件的初始值
  const [edited, setEdited] = useState(() => ours ?? base ?? theirs ?? '');
  useEffect(() => {
    setEdited(ours ?? base ?? theirs ?? '');
  }, [path, base, ours, theirs]);

  return (
    <Flex vertical gap={8} style={{ height: '100%' }}>
      {/* 上排对照区：base→ours / base→theirs 只读 diff；base 缺失（双方新增）退化为两栏只读普通编辑器 */}
      <Flex gap={8} style={{ flex: 1, minHeight: 0 }}>
        {base !== null ? (
          <>
            <Pane title="当前分支">
              <MonacoDiffView original={base} modified={ours ?? ''} options={{ readOnly: true }} loader={loader} />
            </Pane>
            <Pane title="合并来源">
              <MonacoDiffView original={base} modified={theirs ?? ''} options={{ readOnly: true }} loader={loader} />
            </Pane>
          </>
        ) : (
          <>
            <Pane title="当前分支">
              <MonacoEditorLazy value={ours ?? ''} readOnly loader={loader} />
            </Pane>
            <Pane title="合并来源">
              <MonacoEditorLazy value={theirs ?? ''} readOnly loader={loader} />
            </Pane>
          </>
        )}
      </Flex>
      {/* 下排：可编辑合并结果 + 保存（保存时回传 path 与当前编辑内容） */}
      <Pane
        title="合并结果"
        action={
          <Button type="primary" size="small" loading={saving} onClick={() => onSave(path, edited)}>
            保存
          </Button>
        }
      >
        <MonacoEditorLazy value={edited} onChange={setEdited} loader={loader} />
      </Pane>
    </Flex>
  );
}
