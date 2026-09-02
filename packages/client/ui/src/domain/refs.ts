/**
 * refs 分类工具：把 git decorate 原始 ref 串拆为分支/标签两组。
 * 做法：剥离 "HEAD -> " 前缀；"tag: " 前缀判为标签，其余（含 origin/x 远端分支）归分支。
 */

export interface ClassifiedRefs {
  branches: string[];
  tags: string[];
}

export function classifyRefs(refs: string[]): ClassifiedRefs {
  const branches: string[] = [];
  const tags: string[] = [];
  for (const raw of refs) {
    const ref = raw.startsWith('HEAD -> ') ? raw.slice('HEAD -> '.length) : raw;
    if (ref.startsWith('tag: ')) tags.push(ref.slice('tag: '.length));
    else branches.push(ref);
  }
  return { branches, tags };
}
