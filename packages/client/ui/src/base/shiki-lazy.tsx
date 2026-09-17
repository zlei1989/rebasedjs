/**
 * Shiki 高亮器（懒加载模块，仅由 base/code-block 动态 import）。
 *
 * 为什么这块用 Shiki 而不是 Monaco：状态页「补丁预览」的块是**只读小片段**（一个 hunk 十几行、
 * 整份补丁几十行），一块一个、数量随 hunk 数增长。Monaco 的代价不在着色而在**实例**——
 * 每块一个 `createDiffEditor` 要建 DOM 树、注册服务、布局、视口与 worker；Shiki 只做一件事：
 * 文本 → 带颜色的 HTML，没有实例、没有 worker、没有布局。全量编辑器仍归 Monaco
 * （`diff-page` / `readonly-text-view` / `hunk-diff-view`：那边要的是只读编辑器语义——行号、
 * 光标、横向滚动、并排 diff），本模块只服务「只读代码块」这一个形态。
 *
 * 体积口径（**生产构建实测**，`apps/web-next` 的 `next build` 产物）：本模块 + 语法 + 内联 wasm 合成
 * 一个 **1378KB（raw）/ 342KB（gzip）** 的懒加载 chunk（`static/chunks/452_*.js`，内含 `AGFzbQ…`
 * 的 wasm base64、`github-dark`、`diff` 等语法）；语法表里那 11 种语言合计约 680KB raw。
 * 刻意**不用** `import('shiki')` 主入口——那会把 200 多个语法都挂成动态 import 候选，
 * 构建产物里多出几百个永远用不到的 chunk。
 *
 * 高亮与行标记怎么共存：整块一次性 tokenize 是必须的（逐行高亮会切断跨行语法上下文——块注释、
 * 模板字符串、三引号会从第二行起整段错色），但整块 tokenize 的产出没有「行内偏移」，
 * 无法回头把 `+`/`-` 标记插进正文。所以标记不进被高亮的正文，而是作为独立元素挂在每行 token 之前：
 * 正文偏移不变、高亮不受影响，每行的底色由 `data-kind` 交给 CSS。
 *
 * 主题：一次输出双主题（浅色 `color:`、深色 `--shiki-dark:`），由 code-block.css 按
 * `<html data-theme>` 翻转——与全站主题开关（`base/app-theme`）同一口径，不需要重算高亮。
 */
import { createHighlighterCore, type HighlighterGeneric, type LanguageInput } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import diff from 'shiki/langs/diff.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import markdown from 'shiki/langs/markdown.mjs';
import html from 'shiki/langs/html.mjs';
import css from 'shiki/langs/css.mjs';
import shellscript from 'shiki/langs/shellscript.mjs';
import python from 'shiki/langs/python.mjs';
import toml from 'shiki/langs/toml.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import wasm from 'shiki/wasm';
import type { PatchLine } from '../domain/highlight';
import { renderHighlightLines } from '../domain/highlight';

/** 高亮请求：`lines` 有值 = 补丁（带行标记与 diff 底色）；无值 = 整块代码 */
export interface HighlightRequest {
  code: string;
  /** 语言 id（domain/language 的口径）；未收录或未加载的语法 → 返回 null，由调用方退到纯文本 */
  language: string;
  /** 补丁行元数据：整块一次高亮之后逐行挂 `data-kind` 与行首标记 */
  lines?: readonly PatchLine[];
}

/** loader 注入点契约：code-block 只认这个形状，测试注入 stub 即可绕开真实 Shiki */
export interface ShikiHighlighter {
  highlight(request: HighlightRequest): Promise<string | null>;
}

/**
 * 语法表：只收录 `domain/language.ts` 里能判定出来、且体积划算的那几种。
 * 未收录不是缺陷——`highlight` 返回 null，调用方按纯文本渲染（与 language.ts「查不到就 plaintext，
 * 不猜语法」同一口径）；要加语言，在本表加一行 import 即可。
 */
const LANG_GRAMMARS: Record<string, LanguageInput> = {
  diff,
  typescript,
  javascript,
  json,
  yaml,
  markdown,
  html,
  css,
  shellscript,
  python,
  toml,
};

/** 语言别名：只列与 `language.ts` 输出不一致的那些（`ts`/`js`/`md` 等短 id 由 shiki 自身别名表覆盖） */
const LANG_ALIASES: Record<string, string> = {
  shell: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  ini: 'toml',
};

/** 单例：整页共用一次初始化（wasm 编译 + 语法注册），避免每个块各建一个 highlighter */
let highlighterPromise: Promise<HighlighterGeneric<string, string>> | null = null;

function getHighlighter(): Promise<HighlighterGeneric<string, string>> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark, githubLight],
    langs: Object.values(LANG_GRAMMARS),
    engine: createOnigurumaEngine(wasm),
  }) as Promise<HighlighterGeneric<string, string>>;
  return highlighterPromise;
}

/** 高亮结果缓存：同一个 hunk 在折叠/展开、切暂存/工作区视图时会反复渲染，重算一遍不值得 */
const htmlCache = new Map<string, string>();
const HTML_CACHE_LIMIT = 64;

/**
 * 真实实现：未收录语言返回 null（不猜语言、不硬塞错的语法）。
 * token → HTML 的重排（行块、行首标记、双主题样式）在 `domain/highlight.renderHighlightLines`，
 * 那是纯函数、有单测守着；本模块只负责「拿到 token」。
 */
async function highlight({ code, language, lines }: HighlightRequest): Promise<string | null> {
  const grammarId = LANG_ALIASES[language] ?? language;
  if (!(grammarId in LANG_GRAMMARS)) return null;
  const key = `${grammarId}\u0000${lines === undefined ? '' : lines.map((line) => line.kind).join('')}\u0000${code}`;
  const cached = htmlCache.get(key);
  if (cached !== undefined) return cached;
  const highlighter = await getHighlighter();
  const { tokens } = highlighter.codeToTokens(code, {
    lang: grammarId,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: 'light',
    cssVariablePrefix: '--shiki-',
  });
  const rendered = renderHighlightLines(tokens, lines);
  if (htmlCache.size >= HTML_CACHE_LIMIT) htmlCache.clear();
  htmlCache.set(key, rendered);
  return rendered;
}

const defaultExport: ShikiHighlighter = { highlight };
export default defaultExport;
