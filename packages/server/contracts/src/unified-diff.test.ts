import { describe, expect, it } from 'vitest';
import { hunkSides, parseHunkHeader, parseUnifiedDiff } from './unified-diff';

describe('parseHunkHeader', () => {
  it('全量计数字段（@@ -a,b +c,d @@ heading）', () => {
    expect(parseHunkHeader('@@ -10,3 +10,4 @@ fn bar()')).toEqual({
      beforeStart: 10,
      beforeCount: 3,
      afterStart: 10,
      afterCount: 4,
      heading: 'fn bar()',
    });
  });

  it('git 缩写：单值语义为计数 1；无标题为空串', () => {
    expect(parseHunkHeader('@@ -1 +1 @@')).toEqual({
      beforeStart: 1,
      beforeCount: 1,
      afterStart: 1,
      afterCount: 1,
      heading: '',
    });
  });

  it('非 hunk 头返回 null', () => {
    expect(parseHunkHeader('diff --git a/x b/x')).toBeNull();
  });
});

describe('parseUnifiedDiff', () => {
  const TEXT =
    'diff --git a/src/a.ts b/src/a.ts\nindex 111..222 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n' +
    '@@ -1,5 +1,5 @@\n ctx 1\n-old 2\n+new 2\n ctx 3\n ctx 4\n ctx 5\n' +
    '@@ -10,3 +10,4 @@ fn bar()\n keep 10\n+add 11\n keep 12\n keep 13\n';

  it('多 hunk 解析：头字段、顺序、两侧行号游标（@@ 头算术）', () => {
    const hunks = parseUnifiedDiff(TEXT);
    expect(hunks).toHaveLength(2);

    expect(hunks[0].beforeStart).toBe(1);
    expect(hunks[0].afterStart).toBe(1);
    expect(hunks[0].lines.map((l) => [l.kind, l.beforeLine, l.afterLine])).toEqual([
      ['context', 1, 1],
      ['remove', 2, null],
      ['add', null, 2],
      ['context', 3, 3],
      ['context', 4, 4],
      ['context', 5, 5],
    ]);

    expect(hunks[1].heading).toBe('fn bar()');
    expect(hunks[1].lines.map((l) => [l.kind, l.beforeLine, l.afterLine])).toEqual([
      ['context', 10, 10],
      ['add', null, 11],
      ['context', 11, 12],
      ['context', 12, 13],
    ]);
  });

  it('新建文件 @@ -0,0 +1,3 @@：原侧无行号、新侧 1 起', () => {
    const hunks = parseUnifiedDiff('@@ -0,0 +1,3 @@\n+line1\n+line2\n+line3\n');
    expect(hunks[0].beforeStart).toBe(0);
    expect(hunks[0].afterStart).toBe(1);
    expect(hunks[0].lines.map((l) => [l.kind, l.beforeLine, l.afterLine])).toEqual([
      ['add', null, 1],
      ['add', null, 2],
      ['add', null, 3],
    ]);
  });

  it('删除文件 @@ -1,3 +0,0 @@：新侧无行号、原侧 1 起', () => {
    const hunks = parseUnifiedDiff('@@ -1,3 +0,0 @@\n-keep1\n-keep2\n-keep3\n');
    expect(hunks[0].lines.map((l) => [l.kind, l.beforeLine, l.afterLine])).toEqual([
      ['remove', 1, null],
      ['remove', 2, null],
      ['remove', 3, null],
    ]);
  });

  it('\\ No newline at end of file 标记行 → no-newline 行（两侧行号 null，不计数）', () => {
    const hunks = parseUnifiedDiff('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n');
    const kinds = hunks[0].lines.map((l) => l.kind);
    expect(kinds).toEqual(['remove', 'no-newline', 'add', 'no-newline']);
    expect(hunks[0].lines[1].content).toContain('No newline');
    expect(hunks[0].lines[1].beforeLine).toBeNull();
  });

  it('无 hunk（空 patch / 仅头部）返回 []；hunk 外杂散文本容忍', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('diff --git a/x b/x\nindex 1..2 100644\n')).toEqual([]);
    expect(parseUnifiedDiff('@@ -1 +1 @@\ngarbage no-prefix line\n+ok\n')).toHaveLength(1);
  });
});

describe('hunkSides', () => {
  it('按行集组装两侧全文（内容剥离前缀：remove 仅原侧、add 仅新侧、context 双侧）', () => {
    const hunk = parseUnifiedDiff('@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n')[0];
    expect(hunkSides(hunk)).toEqual({ before: 'ctx\nold\n', after: 'ctx\nnew\n' });
  });
});
