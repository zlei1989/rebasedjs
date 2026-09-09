/**
 * 夹具快照：真实 git 建一次模板仓库，之后按需 cpSync 复制出独立副本。
 * 供「同构仓库批量用例」套件（rebase/remote 等每用例重建仓库的场景）：
 * 复制 0 spawn（~几十 ms），替代每用例十余次 git spawn（本机 ~330ms/次）。
 * 副本互不共享状态，测试可随意修改；模板只读、只建一次。
 */
import { cpSync } from 'node:fs';
import { createTmpDir } from './tmp-repo';

/** 复制模板仓库为独立夹具目录，返回其路径（需自行入册清理） */
export function instantiateFixture(template: string): string {
  const dir = createTmpDir('rebased-api-fixture-');
  cpSync(template, dir, { recursive: true });
  return dir;
}
