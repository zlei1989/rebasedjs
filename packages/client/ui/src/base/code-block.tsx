/**
 * 只读代码块：补丁预览/hunk 正文这类**小片段**的语法高亮。
 *
 * 与 Monaco（`monaco-text-view` / `readonly-text-view`）的分工：
 *   · 要「编辑器语义」——行号、光标、横向滚动、并排 diff、可编辑——用 Monaco；
 *   · 只要「把这段代码按语言着色后只读展示」——用本组件（Shiki，无编辑器实例，每块只是一段 HTML）。
 *   本组件存在的直接原因：状态页补丁预览原先是一对裸 `<pre>`（纯等宽、无高亮），
 *   而按块起 Monaco 实例的代价随 hunk 数线性增长（一个补丁几十个块就是几十个编辑器）。
 *
 * 做法：
 *   · 高亮器经 loader 注入（缺省动态 import `./shiki-lazy`），测试注入 stub 绕开真实 Shiki（jsdom 起不了 wasm）；
 *   · **未就绪先出纯文本**：首屏/加载中/失败都渲染同一份文本（此时 `plainLines` 逐行挂 `data-kind`，
 *     diff 底色与 `+`/`-` 前缀不缺席），高亮就绪后整体替换——不闪空、不阻塞；
 *   · 高亮结果按 (code, language, 行种类) 缓存，折叠/展开与视图切换不重复计算；
 *   · 滚动外壳固定在组件根上（`maxHeight` + `overflow: auto`），长补丁在块内滚动，不撑开卡片。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { decoratePatchLines, type PatchLine } from '../domain/highlight';
import './code-block.css';

/** 高亮器模块的默认导出形状：stub 只需实现 `highlight` 这一个方法 */
export interface CodeBlockHighlighter {
  highlight(request: { code: string; language: string; lines?: readonly PatchLine[] }): Promise<string | null>;
}

/**
 * loader 注入点：与 `MonacoLazyLoader` 刻意分开——那边返回的是 **React 组件**（编辑器要挂载 DOM），
 * 这边返回的是**纯函数**（只要一段 HTML）。合并成一个类型就得让某一方接受用不到的字段，
 * 测试桩也会被迫实现无关接口。
 */
export type CodeBlockLoader = () => Promise<CodeBlockHighlighter>;
export interface CodeBlockProps {
  /** 要高亮的文本（补丁全文中含 `@@` 头与 `+`/`-` 前缀） */
  code: string;
  /** 语言 id（domain/language 的推断结果）；给不出时用 'diff'/'plaintext' —— 未收录的语法自动退纯文本 */
  language: string;
  /** 补丁行元数据：给了才逐行挂 diff 底色与行首标记 */
  plainLines?: readonly PatchLine[];
  /** 滚动区最大高度（px）；缺省不限高（由调用方容器决定） */
  maxHeight?: number;
  /** 高亮器注入点（测试用 stub）；缺省动态加载真实 Shiki */
  loader?: CodeBlockLoader;
}

const defaultLoader: CodeBlockLoader = async () => (await import('./shiki-lazy')).default;

/**
 * 纯文本渲染：逐行（有行元数据时）或整段（无行元数据时）——与高亮路径共用同一份文本内容。
 * **行之间不放任何文本节点**（不放 `\n`、也不靠缩进）：`pre` 的空白由 CSS 定为 normal，
 * 行与行的分隔完全由块级 `.line` 承担。早期写法把 `\n` 作为兄弟文本节点塞在 `<pre>` 里，
 * 配上 `white-space: pre` 后 JSX 自身的缩进换行也一起被渲染，每个补丁行之间多出一条空行
 * （冒烟时用 `innerText` 抓到：`lineTexts` 里每行都带着 `\n`）。
 */
function plainBody(code: string, lines?: readonly PatchLine[]): ReactNode {
  if (lines === undefined) return code;
  return lines.map((line, index) => (
    <span className="line" data-kind={line.kind} key={index}>
      {line.content}
    </span>
  ));
}

export function CodeBlock({ code, language, plainLines, maxHeight, loader = defaultLoader }: CodeBlockProps): ReactNode {
  const [html, setHtml] = useState<string | null>(null);
  /**
   * 行元数据的稳定依赖：`plainLines` 每次渲染都是新数组（调用方现算），直接进依赖会让 effect
   * 每轮都重启高亮——高亮永远追不上渲染，界面就永远停在纯文本。用「行种类序列 + 行数」当指纹，
   * 同一份补丁渲染多少次都只算一次。
   */
  const linesKey = plainLines === undefined ? '' : plainLines.map((line) => line.kind).join(',');
  useEffect(() => {
    let active = true;
    setHtml(null);
    // loader 可能被重复调用（每次 effect 重启）：真实 shiki-lazy 是模块级单例，重复调用无副作用
    void loader()
      .then((highlighter) => highlighter.highlight({ code, language, lines: plainLines }))
      .then((next) => {
        if (active) setHtml(next);
      })
      .catch(() => {
        // 加载失败（打包/网络）与语法未收录都只退纯文本，不向上抛：预览块不该因为高亮失败而白屏
        if (active) setHtml(null);
      });
    return () => {
      active = false;
    };
  }, [loader, code, language, linesKey]);

  return (
    <div className="rebased-code-block" style={maxHeight === undefined ? undefined : { maxHeight, overflow: 'auto' }}>
      {html === null ? (
        <pre className="rebased-code-pre" data-testid="code-block-plain">
          {plainBody(code, plainLines)}
        </pre>
      ) : (
        <pre className="rebased-code-pre" data-testid="code-block-highlighted" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

/** 便捷入口：把 unified diff 文本按行标注后再交给 CodeBlock（调用方少写一次 decoratePatchLines） */
export function PatchCodeBlock({
  patch,
  language,
  maxHeight,
  loader,
}: {
  patch: string;
  language: string;
  maxHeight?: number;
  loader?: CodeBlockLoader;
}): ReactNode {
  const lines = decoratePatchLines(patch);
  return <CodeBlock code={patch} language={language} plainLines={lines} maxHeight={maxHeight} loader={loader} />;
}
