import { describe, expect, it } from 'vitest';
import { buildDirectoryTree } from './directory-tree';

describe('buildDirectoryTree', () => {
  it('平铺路径聚合为嵌套树：目录节点聚合子级、键为完整路径', () => {
    const tree = buildDirectoryTree(['A.txt', 'src/index.ts', 'src/lib/b.ts', 'docs/plan.md']);

    expect(tree.map((n) => n.key)).toEqual(['docs', 'src', 'A.txt']); // 目录在前、字母序
    const src = tree.find((n) => n.key === 'src')!;
    expect(src.isLeaf).toBe(false);
    expect(src.selectable).toBe(true); // 目录行点击的展开/收起语义由 FileTree 分派
    expect(src.children!.map((n) => n.key)).toEqual(['src/lib', 'src/index.ts']);
    const lib = src.children!.find((n) => n.key === 'src/lib')!;
    expect(lib.children!.map((n) => n.key)).toEqual(['src/lib/b.ts']);
    expect(lib.children![0].isLeaf).toBe(true);
    expect(lib.children![0].selectable).toBe(true);
  });

  it('空输入返回空数组', () => {
    expect(buildDirectoryTree([])).toEqual([]);
  });

  it('同名目录不重复（深层共享前缀）；节点键为完整路径', () => {
    const tree = buildDirectoryTree(['a/x.txt', 'a/b/c.txt']);
    expect(tree).toHaveLength(1);
    expect(tree[0].key).toBe('a');
    expect(tree[0].children!.map((n) => n.key)).toEqual(['a/b', 'a/x.txt']); // 目录在前、键为完整路径
    expect(tree[0].children![0].children![0].key).toBe('a/b/c.txt');
    expect(tree[0].children![0].children![0].isLeaf).toBe(true);
  });

  it('目录名作为前缀的叶子互不干扰（a 目录 vs a.txt 文件）', () => {
    const tree = buildDirectoryTree(['a/b.txt', 'a.txt']);
    expect(tree.map((n) => n.key)).toEqual(['a', 'a.txt']); // 目录在前规则：a 排在 a.txt 前
    expect(tree[0].children!.map((n) => n.key)).toEqual(['a/b.txt']);
  });
});
