/** checkout 功能测试：branch/newBranch/detach 检出与预检。
 *  性能：带 init 提交的夹具在 beforeAll 建一次模板，用例经 instantiateFixture 复制（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCheckout } from './checkout';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
  dirs.push(repo);
  return repo;
}

// ---- 夹具模板：beforeAll 建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';

beforeAll(() => {
  // 带初始提交的仓库（a.txt 提交为 init）
  baseTemplate = createTmpRepo();
  writeFileSync(join(baseTemplate, 'a.txt'), 'v1');
  execFileSync('git', ['-C', baseTemplate, 'add', '.']);
  execFileSync('git', ['-C', baseTemplate, 'commit', '-q', '-m', 'init']);
  templateDirs.push(baseTemplate);
});

describe('checkout 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('applyCheckout branch 检出既有分支，返回刷新后的 RepoStatus.branch', async () => {
    const repo = instantiate(baseTemplate);
    execFileSync('git', ['-C', repo, 'branch', 'dev']);
    const status = await applyCheckout(repo, { action: 'branch', name: 'dev' });
    expect(status.branch).toBe('dev');
  });

  it('applyCheckout branch 分支不存在 → INVALID_REF', async () => {
    const repo = instantiate(baseTemplate);
    await expect(applyCheckout(repo, { action: 'branch', name: 'nope' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: expect.stringContaining('分支不存在'),
    });
  });

  it('applyCheckout newBranch 新建并检出', async () => {
    const repo = instantiate(baseTemplate);
    const status = await applyCheckout(repo, { action: 'newBranch', name: 'feat-new' });
    expect(status.branch).toBe('feat-new');
  });

  it('applyCheckout newBranch 重名 → INVALID_QUERY', async () => {
    const repo = instantiate(baseTemplate);
    execFileSync('git', ['-C', repo, 'branch', 'dev']);
    await expect(applyCheckout(repo, { action: 'newBranch', name: 'dev' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: expect.stringContaining('分支已存在'),
    });
  });

  it('applyCheckout detach 检出提交哈希后 headHash 不变', async () => {
    const repo = instantiate(baseTemplate);
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = await applyCheckout(repo, { action: 'detach', ref: head });
    expect(status.headHash).toBe(head);
  });
});
