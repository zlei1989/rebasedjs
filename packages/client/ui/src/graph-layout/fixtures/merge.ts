import type { LayoutCommit } from '../types';

/** 两分支合并：a 与 b 并行（lane 0/1），m 合并收拢到 lane 0 */
export const mergeCommits: LayoutCommit[] = [
  { hash: 'm', parents: ['b', 'a'], refs: ['HEAD -> main'] },
  { hash: 'b', parents: ['r'], refs: ['feature'] },
  { hash: 'a', parents: ['r'], refs: [] },
  { hash: 'r', parents: [], refs: [] },
];
