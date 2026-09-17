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

/**
 * Monaco Web Worker 装配（模块级一次性），两件事：
 *
 * ① **装配 worker**：不装配时 Monaco 建不出 worker，退化为「主线程计算 diff」——大 diff（数百行）
 *    会把 diff 计算压在 UI 线程上造成卡顿。打包器（Next/Turbopack、Vite）都支持
 *    `new Worker(new URL(<specifier>, import.meta.url))`：由打包器产出独立 worker chunk 并给出可解析 URL；
 *    MonacoEnvironment 是 Monaco 约定的全局注入点（类型由 monaco-editor 自带的全局声明提供，此处只赋值不重复声明）。
 *
 * ② **关掉四个语言服务的 worker 功能**（见下方 `restrictModeFeatures`）。不关的话，只要打开任意
 *    `.js`/`.ts` 文件，控制台就会持续报 `TypeError: Cannot read properties of undefined (reading 'toUrl')`：
 *    `monaco-editor` 主入口把 json/css/html/typescript 四个语言服务一起装上，其中 typescript 服务挂在
 *    `onLanguage('javascript')` 上，它会 `createWebWorker()`，让 worker 侧去
 *    `import('vs/language/typescript/tsWorker.js')`；而 ESM 构建里这个 URL 由
 *    `FileAccess.asBrowserUri()` → `moduleIdToUrl.toUrl()` 现算，`moduleIdToUrl` 是 AMD 版 `require.toUrl()`
 *    的产物、ESM 里根本不存在 → 实参 undefined、直接抛错。即便绕开这一层，语言模块也不是打包产物、浏览器取不到。
 *    结论：**这条打包链路上语言服务无法工作，本仓只用 Monaco 的语法高亮**——高亮走 basic-languages 的
 *    Monarch（主线程分词），不需要 worker；四个语言服务里唯一值得留的是 JSON 的 `tokens` 项，
 *    因为 basic-languages 里没有 json，它的高亮正是由语言服务的主线程分词器提供的。
 */
if (typeof window !== 'undefined' && window.MonacoEnvironment === undefined) {
  window.MonacoEnvironment = {
    getWorker: () => new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' }),
  };
}

/** 语言服务的 defaults 对象：只需要形状（各语言服务的 modeConfiguration 字段互不相同） */
interface ModeDefaultsLike {
  modeConfiguration: object;
  setModeConfiguration(next: never): void;
}

/**
 * 关掉某个语言服务里所有走 worker 的能力，`keep` 列出的字段保持开启。
 * 按运行时对象的键逐个改写、而不是硬编码字段表：四个语言服务的 modeConfiguration 字段各不相同
 * （css 有 colors、ts 有 inlayHints…），硬编码字段表在 monaco 升级后会漏关新增项。
 */
function restrictModeFeatures(defaults: ModeDefaultsLike, keep: ReadonlyArray<string>): void {
  const next: Record<string, boolean> = {};
  for (const key of Object.keys(defaults.modeConfiguration)) next[key] = keep.includes(key);
  defaults.setModeConfiguration(next as never);
}

if (typeof window !== 'undefined') {
  const { css, html, json, typescript } = monaco.languages;
  // less/scss 复用 css 服务，razor/handlebars 复用 html 服务，故每个 defaults 逐个处理
  const languageServices: ModeDefaultsLike[] = [
    css.cssDefaults,
    css.lessDefaults,
    css.scssDefaults,
    html.htmlDefaults,
    html.razorDefaults,
    html.handlebarDefaults,
    json.jsonDefaults,
    typescript.typescriptDefaults,
    typescript.javascriptDefaults,
  ];
  // 'tokens' 只对 json 生效：其余语言服务的 modeConfiguration 里没有这一项，高亮来自 basic-languages
  for (const defaults of languageServices) restrictModeFeatures(defaults, ['tokens']);
}

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

/**
 * 当前应用主题对应的 Monaco 内置主题名。
 * 应用主题是全局单例（Providers 写到 <html data-theme>），编辑器不重复接收 props 传递；
 * 首帧（data-theme 尚未写入）按暗色兜底——与 Providers 的默认口径一致。
 */
export function appMonacoTheme(): 'vs-dark' | 'light' {
  if (typeof document === 'undefined') return 'vs-dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'vs-dark';
}

/**
 * 订阅 <html data-theme> 变化：主题切换时调 monaco.editor.setTheme（Monaco 主题为全局态，
 * 一处设置即可覆盖本页所有编辑器/差异视图），返回取消订阅函数。
 */
function observeAppTheme(onChange: (theme: 'vs-dark' | 'light') => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(() => onChange(appMonacoTheme()));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** loader 注入点：返回带默认导出编辑器组件的模块（测试可注入 mock 模块绕过真实 monaco）。
 *  默认导出刻意用函数签名而非 ComponentType：函数参数逆变，可同时满足 diff/普通两种调用方 */
export type MonacoLazyLoader = () => Promise<{ default: (props: MonacoLazyProps) => ReactNode }>;

/** diff 模式：挂载后创建 createDiffEditor + setModel({original, modified})；文本更新走独立 effect */
function DiffEditor({ original, modified, language = 'plaintext', options }: MonacoDiffInnerProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  // 创建被推迟一个宏任务（见下方 effect），届时 effect 闭包里的文本可能已过期，故用 ref 取最新文本建模型
  const latestTextRef = useRef({ original, modified });
  useEffect(() => {
    latestTextRef.current = { original, modified };
  }, [original, modified]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let editor: monaco.editor.IStandaloneDiffEditor | undefined;
    let originalModel: monaco.editor.ITextModel | undefined;
    let modifiedModel: monaco.editor.ITextModel | undefined;
    let unsubscribeTheme: () => void = () => {};
    // 创建推迟一个宏任务、清理时撤销：React 严格模式（开发态）对每个 effect 走「挂载 → 卸载 → 再挂载」，
    // 同步创建会让第一次挂载的编辑器连同两个模型在同一 tick 内被销毁；而它的 diff 计算已经在 worker 里起飞，
    // 模型一销毁该计算随即被拒（worker 客户端随「模型服务清空」被回收 → Canceled；worker 侧镜像模型被摘除 →
    // no diff result available），拒绝无人接管 → 页面控制台报错。推迟后，被撤销的那次挂载一个实例都不会建。
    const timer = setTimeout(() => {
      const latest = latestTextRef.current;
      // automaticLayout：容器尺寸变化（窗口缩放/侧栏开合/详情面板出现）时经 ResizeObserver 自动重排；
      // 缺省 false 时编辑器只在创建时量一次尺寸——冒烟实测窄屏创建后放大到 1440 仍是 320px 宽（右侧大片空白）
      editor = monaco.editor.createDiffEditor(container, { readOnly: true, theme: appMonacoTheme(), automaticLayout: true, ...options });
      originalModel = monaco.editor.createModel(latest.original, language);
      modifiedModel = monaco.editor.createModel(latest.modified, language);
      editor.setModel({ original: originalModel, modified: modifiedModel });
      editorRef.current = editor;
      // 主题切换（设置页改 dark/light）后跟随：Monaco 主题是全局态，setTheme 一次覆盖全部实例
      unsubscribeTheme = observeAppTheme((theme) => monaco.editor.setTheme(theme));
    }, 0);
    return () => {
      clearTimeout(timer);
      unsubscribeTheme();
      editorRef.current = null;
      editor?.dispose();
      originalModel?.dispose();
      modifiedModel?.dispose();
    };
    // 仅 language 变化时重建；文本更新走下方 effect
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
    const editor = monaco.editor.create(container, { value, language, readOnly, theme: appMonacoTheme(), automaticLayout: true, ...options });
    // 内容变化（用户输入）时回传最新全文；下方受控 setValue 会带回同值，由调用方状态去重
    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current?.(editor.getValue());
    });
    editorRef.current = editor;
    // 主题切换跟随（同 DiffEditor）
    const unsubscribe = observeAppTheme((theme) => monaco.editor.setTheme(theme));
    return () => {
      unsubscribe();
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
