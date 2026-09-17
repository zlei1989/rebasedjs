/**
 * 补丁行标注纯函数（无 DOM、无第三方依赖）。
 *
 * 做什么：把一段 unified diff 文本切成「行 + 行种类」，供只读代码块在**整块高亮之后**逐行贴样式类。
 *
 * 为什么要先整块高亮再切行，而不是逐行高亮再拼：
 *   逐行喂给高亮器会切断多行语法上下文——块注释、模板字符串、Python 三引号跨行时，
 *   第二行起会被当成普通代码重新分词，颜色整段错位。所以整块一次性高亮，
 *   再按 `\n` 把产出切成行，此时每行的 DOM 是完整的，只需补一个「这行是加/删/上下文」的类名。
 *   行种类就由本函数提供：它按行首字符判定，与 unified diff 的行语义一一对应。
 *
 * 怎么判定（与 unified diff 格式同源，不猜、不做启发式）：
 *   `@@` 开头 → hunk 头；`+++`/`---` 开头 → 文件头（不是增删行，标 header）；
 *   `+`/`-` 开头 → 新增/删除；`\` 开头 → `\ No newline at end of file` 标记行；
 *   其余 → 上下文行；去掉行尾 `\r` 后为空 → 空行。
 *
 * 另外导出高亮 token 的 HTML 渲染（`renderHighlightLines`）：它同样是纯函数，
 * 且是最容易写错的一环（双主题下浅色只存在于 `htmlStyle`），放在这里便于单测守着。
 */

/** 行种类：决定该行在只读代码块里挂哪个样式类（diff 底色与前缀色） */
export type PatchLineKind = 'hunk' | 'header' | 'add' | 'remove' | 'context' | 'noNewline' | 'blank';

/** 一行补丁：kind 用于贴类名；content 为该行原文（**保留前缀字符**，前缀本身要着色） */
export interface PatchLine {
  kind: PatchLineKind;
  content: string;
}

/** 行首特征 → 种类：顺序即优先级（`+++`/`---` 必须先于 `+`/`-` 判定，否则文件头会被当成增删行） */
function kindOf(line: string): PatchLineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'header';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  if (line.startsWith('\\')) return 'noNewline';
  return line === '' ? 'blank' : 'context';
}

/**
 * 切分 unified diff 文本为带种类的行数组。
 * 切法与 contracts `splitPatchHunks` 同源（`/[^\n]*(?:\n|$)/` 后滤掉空串），
 * 于是「最后一个 \n」不会被算成额外的一行空行（否则每个 hunk 末尾都会多出一条空行）。
 * 行尾 `\r` 剥掉：CRLF 工作区的补丁会带着它，原样渲染会在行尾多出一个控制符。
 */
export function decoratePatchLines(text: string): PatchLine[] {
  const raw = (text.match(/[^\n]*(?:\n|$)/g) ?? []).filter((line) => line !== '');
  return raw.map((line) => {
    // 剥行尾 \n 与它前面的 \r：只有真以 \n 结尾的行才剥 \r，行内的 \r 是内容、不能动
    const content = line.endsWith('\n') ? line.slice(0, line.endsWith('\r\n') ? -2 : -1) : line;
    return { kind: kindOf(content), content };
  });
}

/** 行首标记：与 unified diff 的原始前缀同字符（上下文行是空格，hunk 头与空行不加） */
export const PATCH_MARKER: Record<PatchLineKind, string> = {
  hunk: '',
  header: '',
  add: '+',
  remove: '-',
  context: ' ',
  noNewline: '\\',
  blank: '',
};

/**
 * 高亮 token 的最小形状：只需要「文本」与「行内样式」。
 * 刻意**不 import shiki 的类型**——domain 层是纯逻辑，上面这层不该被高亮器的类型绑住
 * （换高亮器只要还产出这两样东西，渲染与测试都不用动）。
 */
export interface HighlightToken {
  content: string;
  /** 行内样式表（如 `{ color: '#D73A49', '--shiki-dark': '#F97583' }`）；缺省表示无着色 */
  htmlStyle?: Record<string, string>;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 把逐行 token 渲染成可 `dangerouslySetInnerHTML` 的 HTML 片段。
 *
 * 两个要点：
 *   ① 每行是一个**块级** `.line`（CSS 里 `display: block`）——行底色与行首标记要占满整行；
 *   ② 颜色**整体序列化 `token.htmlStyle`**，而不是取 `token.color` 再拼深色变量。
 *      双主题下浅色只存在于 `htmlStyle` 里（`color` 与 `bgColor` 都是 undefined），
 *      取后者会写出 `color:undefined` —— 页面上一整块同色，且样式串里留着明显的坏值。
 *      这一条有回归测试守着（highlight.test.ts 的「不产出 color:undefined」）。
 */
export function renderHighlightLines(tokens: readonly (readonly HighlightToken[])[], lines?: readonly PatchLine[]): string {
  return tokens
    .map((lineTokens, index) => {
      const line = lines?.[index];
      const marker =
        line === undefined || PATCH_MARKER[line.kind] === ''
          ? ''
          : `<span class="diff-marker">${escapeHtml(PATCH_MARKER[line.kind])}</span>`;
      const body = lineTokens
        .map((token) => {
          const style = Object.entries(token.htmlStyle ?? {})
            .map(([key, value]) => `${key}:${value}`)
            .join(';');
          return `<span class="code"${style === '' ? '' : ` style="${style}"`}>${escapeHtml(token.content)}</span>`;
        })
        .join('');
      return line === undefined
        ? `<span class="line">${body}</span>`
        : `<span class="line" data-kind="${line.kind}">${marker}${body}</span>`;
    })
    .join('\n');
}
