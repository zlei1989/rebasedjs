import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IgnoreAddBody } from '@rebased/contracts';
import { addIgnore, getIgnore, getIgnoreTemplates, putIgnore } from './ignore';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

afterAll(() => dirs.forEach(cleanupTmpRepo));

function repo(): string {
  const r = createTmpRepo();
  dirs.push(r);
  return r;
}

describe('ignore 功能', () => {
  it('初始读取：.gitignore 不存在 → 空串；exclude 删除后 → 空串（不存在 → \'\' 分支）', async () => {
    const r = repo();
    const contents = await getIgnore(r);
    expect(contents.gitignore).toBe('');
    expect(typeof contents.exclude).toBe('string');
    // git init 会生成模板 exclude；删除后再读应返回 ''（不存在 → '' 分支）
    const excludeFile = join(r, '.git', 'info', 'exclude');
    if (existsSync(excludeFile)) rmSync(excludeFile);
    expect((await getIgnore(r)).exclude).toBe('');
  });

  it('putIgnore gitignore：不存在则创建并返回刷新视图', async () => {
    const r = repo();
    const view = await putIgnore(r, { target: 'gitignore', content: 'node_modules/\ndist/\n' });
    expect(view.gitignore).toBe('node_modules/\ndist/\n');
    expect(existsSync(join(r, '.gitignore'))).toBe(true);
  });

  it('putIgnore exclude：.git/info/ 目录不存在时先创建', async () => {
    const r = repo();
    rmSync(join(r, '.git', 'info'), { recursive: true, force: true });
    const view = await putIgnore(r, { target: 'exclude', content: 'dist/\n' });
    expect(view.exclude).toBe('dist/\n');
    expect(existsSync(join(r, '.git', 'info', 'exclude'))).toBe(true);
  });

  it('addIgnore：追加 /<path> 行（路径原样），文件不存在则创建', async () => {
    const r = repo();
    const v1 = await addIgnore(r, { path: 'node_modules' });
    expect(v1.gitignore).toBe('/node_modules\n');
    const v2 = await addIgnore(r, { path: 'dist' });
    expect(v2.gitignore).toBe('/node_modules\n/dist\n');
    expect(existsSync(join(r, '.gitignore'))).toBe(true);
  });

  it('addIgnore 幂等：行 trim 后等于 /<path> 即视为已存在，不重复追加', async () => {
    const r = repo();
    writeFileSync(join(r, '.gitignore'), '/node_modules\n  /spaced  \n/other\n');
    const v1 = await addIgnore(r, { path: 'node_modules' });
    expect(v1.gitignore).toBe('/node_modules\n  /spaced  \n/other\n');
    const v2 = await addIgnore(r, { path: 'spaced' });
    expect(v2.gitignore).toBe('/node_modules\n  /spaced  \n/other\n');
  });

  it('addIgnore：文件末尾无换行先补换行再追加', async () => {
    const r = repo();
    writeFileSync(join(r, '.gitignore'), '/a.txt');
    const v = await addIgnore(r, { path: 'b' });
    expect(v.gitignore).toBe('/a.txt\n/b\n');
  });

  it('addIgnore target=exclude：同样追加到 .git/info/exclude 且幂等', async () => {
    const r = repo();
    const body: IgnoreAddBody & { target: 'exclude' } = { path: 'dist', target: 'exclude' };
    const v1 = await addIgnore(r, body);
    expect(v1.exclude.includes('/dist\n')).toBe(true);
    const v2 = await addIgnore(r, body);
    expect(v2.exclude).toBe(v1.exclude);
  });

  it('getIgnoreTemplates：内建 Node / Python / 通用 三模板（内容可供直接落盘）', () => {
    const templates = getIgnoreTemplates();
    expect(templates.map((t) => t.id)).toEqual(['node', 'python', 'general']);
    expect(templates.map((t) => t.name)).toEqual(['Node.js', 'Python', '通用']);
    for (const t of templates) {
      expect(t.content.length).toBeGreaterThan(0);
    }
  });
});
