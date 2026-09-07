import { describe, expect, it } from 'vitest';
import { patchHunkHeading, splitPatchHunks } from './patch';

describe('splitPatchHunks', () => {
  it('多 hunk：头部在前、hunk 按出现顺序编号、text 含头行与正文', () => {
    const text =
      'diff --git a/a.txt b/a.txt\nindex 111..222 100644\n--- a/a.txt\n+++ b/a.txt\n' +
      '@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n' +
      '@@ -10,3 +10,4 @@ fn bar()\n more\n+added\n';
    const split = splitPatchHunks(text);
    expect(split.header).toBe('diff --git a/a.txt b/a.txt\nindex 111..222 100644\n--- a/a.txt\n+++ b/a.txt\n');
    expect(split.hunks).toHaveLength(2);
    expect(split.hunks[0].index).toBe(0);
    expect(split.hunks[0].header).toBe('@@ -1,2 +1,2 @@\n');
    expect(split.hunks[0].text).toBe('@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n');
    expect(split.hunks[1].index).toBe(1);
    expect(split.hunks[1].text).toBe('@@ -10,3 +10,4 @@ fn bar()\n more\n+added\n');
  });

  it('末行 \\ No newline 归属其上方 hunk', () => {
    const text = '@@ -1 +1 @@\n-old\\n\\ No newline at end of file\n+new\\n\\ No newline at end of file\n';
    const split = splitPatchHunks(text);
    expect(split.header).toBe('');
    expect(split.hunks).toHaveLength(1);
    expect(split.hunks[0].text).toBe(text);
  });

  it('空文本与无 hunk 文本', () => {
    expect(splitPatchHunks('')).toEqual({ header: '', hunks: [] });
    const onlyHeader = splitPatchHunks('diff --git a/x b/x\n');
    expect(onlyHeader).toEqual({ header: 'diff --git a/x b/x\n', hunks: [] });
  });

  it('CRLF 行尾保持原样', () => {
    const text = '@@ -1 +1 @@\r\n-old\r\n+new\r\n';
    const split = splitPatchHunks(text);
    expect(split.hunks[0].text).toBe(text);
  });
});

describe('patchHunkHeading', () => {
  it('提取第二个 @@ 后的标题', () => {
    expect(patchHunkHeading('@@ -1,2 +1,2 @@ fn main() {\n')).toBe('fn main() {');
    expect(patchHunkHeading('@@ -1 +1 @@\n')).toBe('');
  });
});
