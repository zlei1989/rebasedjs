/**
 * Monaco 差异编辑器（懒加载模块，仅由 monaco-diff-view 动态 import）。
 * 做法：挂载时 createDiffEditor 并 setModel({original, modified})；
 * props 变化时更新模型值，卸载时 dispose 模型与编辑器。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import * as monaco from 'monaco-editor';
import type { MonacoDiffInnerProps } from './monaco-diff-view';

export default function MonacoDiffEditor({ original, modified, language = 'plaintext', options }: MonacoDiffInnerProps): ReactNode {
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
