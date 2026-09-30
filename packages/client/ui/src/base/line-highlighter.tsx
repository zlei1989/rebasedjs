/**
 * 逐行语法高亮：整块 tokenize 之后**按行取 token**，供自绘行表逐行着色。
 *
 * 与 base/code-block 的分工（共用同一个 Shiki 单例，只是两条渲染路径）：
 *   · `CodeBlock` 产出一整块 HTML 字符串，服务补丁/hunk 这类只读小片段；
 *   · 本模块产出**逐行 token 数组**——注解行表里每一行都是独立的 React 行（行号/时间/哈希、
 *     点击浮层、选中底色都挂在行上），HTML 字符串塞不进行容器。
 * 两条路径的共同硬约束：必须**整块** tokenize 再切行。逐行喂高亮器会切断跨行语法上下文
 * （块注释、模板字符串、三引号从第二行起整段错色），见 domain/highlight 的文件头。
 *
 * 取不到就退纯文本：未收录语言、wasm 未就绪、加载失败、**行数与源文件不一致**一律返回 null——
 * 错位的着色比没有着色更误导（与 domain/language「不猜语法」同一口径）。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { HighlightToken } from '../domain/highlight';
import './code-block.css';

/** 高亮请求：整份文件正文 + 语言 id（domain/language 的口径） */
export interface LineHighlightRequest {
  code: string;
  language: string;
}

/** 高亮器契约：只认「逐行 token」这一件事（测试注入 stub 即绕开真实 Shiki/wasm） */
export interface LineHighlighter {
  highlightLines(request: LineHighlightRequest): Promise<HighlightToken[][] | null>;
}

/** loader 注入点：返回带默认导出的高亮器模块（与 base/code-block 的 CodeBlockLoader 同一手法） */
export type LineHighlighterLoader = () => Promise<LineHighlighter>;

const defaultLoader: LineHighlighterLoader = async () => (await import('./shiki-lazy')).default;

/**
 * 逐行高亮 hook：文本或语言变化时重算（结果由 shiki-lazy 缓存，重复渲染不重复 tokenize）。
 * effect 里带 active 标记：切文件/切版本时旧请求回来不能覆盖新结果。
 */
export function useHighlightedLines(
  { code, language }: LineHighlightRequest,
  loader: LineHighlighterLoader = defaultLoader,
): HighlightToken[][] | null {
  const [lines, setLines] = useState<HighlightToken[][] | null>(null);
  useEffect(() => {
    let active = true;
    setLines(null);
    void loader()
      .then((highlighter) => highlighter.highlightLines({ code, language }))
      .then((next) => {
        if (active) setLines(next);
      })
      .catch(() => {
        // 加载失败（打包/网络）与语法未收录同待遇：退纯文本，不向上抛（行表不该因高亮失败而白屏）
        if (active) setLines(null);
      });
    return () => {
      active = false;
    };
  }, [loader, code, language]);
  return lines;
}

/**
 * 一行的 token → 行内 span 序列。
 * 双主题一次输出：浅色在 `color`、深色在 `--shiki-dark`，由 code-block.css 按 `<html data-theme>` 翻转。
 * `htmlStyle` 是 `Record<string, string>`（含自定义属性 `--shiki-dark`），React 支持自定义属性透传，
 * 但类型上要断言成 CSSProperties。
 */
export function HighlightedTokens({ tokens }: { tokens: readonly HighlightToken[] }): ReactNode {
  return tokens.map((token, index) => (
    <span className="code" style={token.htmlStyle as CSSProperties | undefined} key={index}>
      {token.content}
    </span>
  ));
}
