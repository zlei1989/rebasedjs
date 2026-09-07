/**
 * unified diff 切片纯函数：跨端共享（api 服务端 hunk 索引重组 与 ui 行内 hunk 选择必须同源切片）。
 * 切片语义与服务端原实现逐行对齐（见 api/staging.ts 历史）：按行扫描——
 * `diff --git` 起至首个 `@@` 前为头部；每个 `@@ ... @@` 行开启一个 hunk，
 * 行至下一 `@@` 或文件尾（末行 `\ No newline at end of file` 归属其上方 hunk）。
 * 行尾保留原始 \n（git apply 重组要求完整行结构）。
 */

/** hunk 切片：index 为文件内 0 基序号（提交 hunkStagingBody.hunks 的编号）；text 含头行与正文 */
export interface PatchHunk {
  index: number;
  /** hunk 头行（`@@ -a,b +c,d @@[ 上下文]`，含换行） */
  header: string;
  /** 头行 + 正文（含换行；末行 `\ No newline` 归属本 hunk） */
  text: string;
}

/** 切片结果：header 为首个 @@ 前的 diff 头部（含换行）；hunks 按文件出现顺序 */
export interface SplitPatch {
  header: string;
  hunks: PatchHunk[];
}

/** 从 `@@` 头行提取上下文标题（第二个 @@ 之后、去首尾空白；无则空串——展示用，不影响切片） */
export function patchHunkHeading(headerLine: string): string {
  const second = headerLine.indexOf('@@', 2);
  if (second === -1) return '';
  return headerLine.slice(second + 2).trim();
}

/** 切分 unified diff 全文为「头部 + hunks」；空文本 → { header:'', hunks:[] }（空 diff 场景） */
export function splitPatchHunks(text: string): SplitPatch {
  const lines = (text.match(/[^\n]*(?:\n|$)/g) ?? []).filter((l) => l !== '');
  let header = '';
  const hunks: { header: string; body: string }[] = [];
  for (const line of lines) {
    if (line.startsWith('@@')) hunks.push({ header: line, body: line });
    else if (hunks.length === 0) header += line;
    else hunks[hunks.length - 1].body += line;
  }
  return {
    header,
    hunks: hunks.map((hunk, index) => ({ index, header: hunk.header, text: hunk.body })),
  };
}
