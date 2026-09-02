import type { LayoutCommit } from '../types';

/** 线性链 A←B←C（C 最新）：单 lane，直边 */
export const linearCommits: LayoutCommit[] = [
  { hash: 'c', parents: ['b'], refs: ['HEAD -> main'] },
  { hash: 'b', parents: ['a'], refs: [] },
  { hash: 'a', parents: [], refs: [] },
];
