/**
 * Monaco 编辑器（懒加载模块，仅由 monaco-diff-view / merge-view 动态 import）。
 * 双模式（运行时按 props 有无 value 判别）：
 *  - diff 模式（original + modified）：createDiffEditor，只读由 options 控制；
 *  - 普通模式（value）：create 单编辑器，可选 readOnly，onChange 回传编辑内容（合并结果编辑用）。
 * 做法：挂载时创建编辑器；props 变化时更新模型值；卸载时 dispose 模型与编辑器。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import * as monaco from 'monaco-editor';
import type { MonacoDiffInnerProps } from './monaco-diff-view';

/** 普通单编辑器模式 props：value 受控，onChange 回传用户编辑后的全文 */
export interface MonacoEditorInnerProps {
  value: string;
  language?: string;
  /** 只读展示（如双方新增冲突的 ours/theirs 对照栏） */
  readOnly?: boolean;
  onChange?: (value: string) => void;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
}

/** monaco-lazy 默认导出组件 props：diff 模式与普通模式二选一 */
export type MonacoLazyProps = MonacoDiffInnerProps | MonacoEditorInnerProps;

/** loader 注入点：返回带默认导出编辑器组件的模块（测试可注入 mock 模块绕过真实 monaco）。
 *  默认导出刻意用函数签名而非 ComponentType：函数参数逆变，可同时满足 diff/普通两种调用方 */
export type MonacoLazyLoader = () => Promise<{ default: (props: MonacoLazyProps) => ReactNode }>;

/** diff 模式：挂载时 createDiffEditor 并 setModel({original, modified})；文本更新走独立 effect */
function DiffEditor({ original, modified, language = 'plaintext', options }: MonacoDiffInnerProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.createDiffEditor(container, { readOnly: true, theme: 'vs-dark', ...options });
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    editor.setModel({ original: originalModel, modified: modifiedModel });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editorRef.current = null;
    };
    // 仅挂载时创建；文本更新走下方 effect
  }, [language]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    if (model.original.getValue() !== original) model.original.setValue(original);
    if (model.modified.getValue() !== modified) model.modified.setValue(modified);
  }, [original, modified]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

/** 普通模式：挂载时 create 单编辑器；用户编辑经 onDidChangeModelContent 回传全文 */
function PlainEditor({ value, language = 'plaintext', readOnly = false, onChange, options }: MonacoEditorInnerProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  // onChange 经 ref 取用：回调身份变化不应触发编辑器重建
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = monaco.editor.create(container, { value, language, readOnly, theme: 'vs-dark', ...options });
    // 内容变化（用户输入）时回传最新全文；下方受控 setValue 会带回同值，由调用方状态去重
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });
    editorRef.current = editor;
    return () => {
      subscription.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // 仅挂载时创建；文本更新走下方 effect（与 diff 模式同约定）
  }, [language]);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}

export default function MonacoLazy(props: MonacoLazyProps): ReactNode {
  return 'value' in props ? <PlainEditor {...props} /> : <DiffEditor {...props} />;
}
