/**
 * 目录树构建纯函数：平铺路径列表 → 嵌套 FileTreeNode（目录节点聚合、目录在前字母序）。
 * 供 BrowsePanel（ls-tree 平铺条目）与 CommittedChangesPanel 目录树共用；
 * 键即完整路径（git 路径恒以 / 分隔）。节点 selectable 恒为 true——目录行点击的
 * 「展开/收起」语义由 FileTree 的 onSelect 分派（目录不进入选中态），调用方可按条目形态覆写叶子。
 */
import type { FileTreeNode } from '../base/file-tree';

/** 构建中节点：children 以 basename 键控（同层唯一——git 树中同名 blob/tree 不可能并存） */
interface MutableNode {
  key: string;
  title: string;
  isLeaf: boolean;
  children: Map<string, MutableNode>;
}

/** 平铺路径 → 嵌套树：目录在前、字母序；单层路径（如根级 A.txt）直接落为叶子 */
export function buildDirectoryTree(paths: string[]): FileTreeNode[] {
  const root = new Map<string, MutableNode>();
  for (const path of paths) {
    const segments = path.split('/');
    let level = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      let node = level.get(seg);
      if (node === undefined) {
        node = { key: segments.slice(0, i + 1).join('/'), title: seg, isLeaf: isLast, children: new Map() };
        level.set(seg, node);
      }
      level = node.children;
    }
  }
  const toNodes = (map: Map<string, MutableNode>): FileTreeNode[] => {
    const list = [...map.values()];
    list.sort((a, b) => {
      const aDir = a.isLeaf ? 1 : 0;
      const bDir = b.isLeaf ? 1 : 0;
      if (aDir !== bDir) return aDir - bDir; // 目录在前
      return a.title.localeCompare(b.title);
    });
    return list.map((node) => ({
      key: node.key,
      title: node.title,
      isLeaf: node.isLeaf,
      selectable: true,
      ...(node.children.size > 0 ? { children: toNodes(node.children) } : {}),
    }));
  };
  return toNodes(root);
}
