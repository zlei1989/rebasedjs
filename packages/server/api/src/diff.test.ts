import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFileDiff, streamDiffEvents } from './diff';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('diff 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getFileDiff 返回契约形状', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const d = await getFileDiff(repo, { file: 'a.txt', staged: false });
    expect(d.path).toBe('a.txt');
    expect(d.text).toContain('+v2');
  });

  it('streamDiffEvents 产出契约事件且内容与全文一致', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const full = await getFileDiff(repo, { file: 'a.txt', staged: false });
    let text = '';
    for await (const e of streamDiffEvents(repo, { file: 'a.txt', staged: false })) {
      expect(e.type).toBe('diff.chunk');
      text += e.payload.text;
    }
    expect(text).toBe(full.text);
  });

  it('仅提供 from 无 to 时抛 INVALID_QUERY', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileDiff(repo, { file: 'a.txt', from: 'HEAD', staged: false })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(streamDiffEvents(repo, { file: 'a.txt', from: 'HEAD', staged: false })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('staged 与 from/to 并存时抛 INVALID_QUERY', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileDiff(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD', staged: true })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(streamDiffEvents(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD', staged: true })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});
