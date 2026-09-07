/**
 * unified diff → 两侧行级解析（纯函数，GitHub/GitLab 共用——二者 patch/diff 字段均为单文件 unified diff 全文）。
 * 产出逐 hunk、逐行的两侧行号映射（@@ 头算术）：评论区锚点（path + line + side）与行级视图渲染共用。
 *
 * 语义与 git diff 对齐：
 * - `@@ -a,b +c,d @@ heading` → 原侧起始行 a、新侧起始行 c（b/d 为 0 时 a/c 表示「该侧 0 行」的特殊约定，如新建 @@ -0,0 +1,3 @@、删除 @@ -1,3 +0,0 @@）；
 * - 行号游标：context 两侧同时推进；remove 仅原侧推进；add 仅新侧推进；
 * - `\ No newline at end of file` 记为 no-newline 行（两侧行号 null，渲染为提示行）；
 * - `diff --git`/`index`/`---`/`+++` 等头部行跳过；hunk 外文本忽略（容忍截断/二进制遗存）。
 */

/** 逐行解析结果：content 为剥离前缀的行内容（no-newline 行保留原文）；行号 1-based，缺侧为 null */
export interface UnifiedHunkLine {
  kind: 'context' | 'add' | 'remove' | 'no-newline';
  content: string;
  /** 原侧文件行号（add 行为 null） */
  beforeLine: number | null;
  /** 新侧文件行号（remove 行为 null） */
  afterLine: number | null;
}

/** 逐 hunk 解析结果：beforeStart/afterStart 为 @@ 头声明的两侧起始行（新文件为 0） */
export interface UnifiedHunk {
  beforeStart: number;
  afterStart: number;
  beforeCount: number;
  afterCount: number;
  /** @@ 头第二个 @@ 之后的上下文标题（无则空串） */
  heading: string;
  lines: UnifiedHunkLine[];
}

/** @@ 头正则：`@@ -a,b +c,d @@[ heading]`；单值（如 `@@ -1 +1 @@`）按 b=d=1 处理（git 缩写省略计数） */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** 解析 hunk 头行 → 头字段；非 hunk 头返回 null */
export function parseHunkHeader(line: string): Omit<UnifiedHunk, 'lines'> | null {
  const m = HUNK_HEADER.exec(line.trim());
  if (m === null) return null;
  return {
    beforeStart: Number(m[1]),
    beforeCount: m[2] === undefined ? 1 : Number(m[2]),
    afterStart: Number(m[3]),
    afterCount: m[4] === undefined ? 1 : Number(m[4]),
    heading: (m[5] ?? '').trim(),
  };
}

/**
 * 解析单文件 unified diff → hunks（顺序保持文件出现顺序）。
 * 无 hunk（空 patch / 仅头部 / 二进制）→ []——调用方据 status 区分降级提示。
 */
export function parseUnifiedDiff(text: string): UnifiedHunk[] {
  const hunks: UnifiedHunk[] = [];
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [];
  for (const raw of lines) {
    if (raw === '') continue;
    const trimmed = raw.replace(/\n$/, '');
    const header = parseHunkHeader(trimmed);
    if (header !== null) {
      hunks.push({ ...header, lines: [] });
      continue;
    }
    const current = hunks[hunks.length - 1];
    if (current === undefined) continue; // hunk 外：头部/杂散文本跳过
    const [prefix, content] = trimLine(raw);
    if (prefix === '\\') {
      current.lines.push({ kind: 'no-newline', content: content ?? '', beforeLine: null, afterLine: null });
      continue;
    }
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') continue; // 容错：非法行跳过
    current.lines.push({
      kind: prefix === ' ' ? 'context' : prefix === '+' ? 'add' : 'remove',
      content: content ?? '',
      beforeLine: prefix === '+' ? null : current.beforeStart + beforeCountSoFar(current),
      afterLine: prefix === '-' ? null : current.afterStart + afterCountSoFar(current),
    });
  }
  return hunks;
}

/** 行前缀剥离：返回 [前缀, 内容]（行尾 \n 保留在 content——渲染等宽原样呈现） */
function trimLine(raw: string): [string, string | undefined] {
  const prefix = raw.slice(0, 1);
  return [prefix, raw.slice(1)];
}

/** 当前 hunk 内已消费的原侧行数（remove/context 计数） */
function beforeCountSoFar(hunk: UnifiedHunk): number {
  return hunk.lines.filter((l) => l.kind === 'remove' || l.kind === 'context').length;
}

/** 当前 hunk 内已消费的新侧行数（add/context 计数） */
function afterCountSoFar(hunk: UnifiedHunk): number {
  return hunk.lines.filter((l) => l.kind === 'add' || l.kind === 'context').length;
}

/** 按 hunk 组装两侧全文（渲染 MonacoDiffView 用）：两侧均含该 hunk 行集（无行距合并——行级视图按 hunk 渲染，不重建整文件） */
export function hunkSides(hunk: UnifiedHunk): { before: string; after: string } {
  let before = '';
  let after = '';
  for (const line of hunk.lines) {
    switch (line.kind) {
      case 'remove':
        before += line.content;
        break;
      case 'add':
        after += line.content;
        break;
      case 'context':
        before += line.content;
        after += line.content;
        break;
      case 'no-newline':
        break;
    }
  }
  return { before, after };
}
