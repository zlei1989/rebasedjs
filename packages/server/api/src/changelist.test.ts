import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyChangelistAction, getChangelists } from './changelist';
import { openRepo } from './repo';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

let configDir: string;
const dirs: string[] = [];

beforeAll(() => {
  // 配置目录隔离：每个测试文件独立 REBASED_CONFIG_DIR，避免污染用户配置
  configDir = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

/** 造临时仓库并注册（簿记按 repoId 键控，需先 openRepo） */
async function registeredRepo(): Promise<string> {
  const repo = createTmpRepo();
  dirs.push(repo);
  await openRepo(repo);
  return repo;
}

describe('changelist 功能', () => {
  it('初始视图：恰含默认列表（isDefault=true），assignments 空', async () => {
    const repo = await registeredRepo();
    const view = await getChangelists(repo);
    expect(view.lists).toEqual([{ id: 'default', name: '默认', isDefault: true }]);
    expect(view.assignments).toEqual({});
  });

  it('create → move → rename → setDefault → delete 全流程', async () => {
    const repo = await registeredRepo();
    // 造工作区改动（未跟踪文件即进入 status）
    writeFileSync(join(repo, 'a.txt'), 'a');
    writeFileSync(join(repo, 'b.txt'), 'b');

    // create 新列表
    let view = await applyChangelistAction(repo, { action: 'create', name: '功能A' });
    expect(view.lists).toHaveLength(2);
    const listA = view.lists.find((l) => l.name === '功能A');
    expect(listA?.isDefault).toBe(false);

    // move 现存路径到功能A
    view = await applyChangelistAction(repo, { action: 'move', paths: ['a.txt'], targetId: listA!.id });
    expect(view.assignments['a.txt']).toBe(listA!.id);

    // rename 改名
    view = await applyChangelistAction(repo, { action: 'rename', id: listA!.id, name: '功能B' });
    expect(view.lists.find((l) => l.id === listA!.id)?.name).toBe('功能B');

    // setDefault 默认标记迁移
    view = await applyChangelistAction(repo, { action: 'setDefault', id: listA!.id });
    expect(view.lists.find((l) => l.id === listA!.id)?.isDefault).toBe(true);
    expect(view.lists.find((l) => l.id === 'default')?.isDefault).toBe(false);
    view = await applyChangelistAction(repo, { action: 'setDefault', id: 'default' });
    expect(view.lists.find((l) => l.id === 'default')?.isDefault).toBe(true);

    // delete 非默认列表 → 其路径归默认（无显式 assignment）
    view = await applyChangelistAction(repo, { action: 'delete', id: listA!.id });
    expect(view.lists).toHaveLength(1);
    expect(view.lists[0].id).toBe('default');
    expect(view.assignments['a.txt']).toBeUndefined();
  });

  it('修剪：move 后撤销文件改动 → 再读视图 assignments 不再含该路径', async () => {
    const repo = await registeredRepo();
    writeFileSync(join(repo, 'a.txt'), 'a');
    const created = await applyChangelistAction(repo, { action: 'create', name: '临时' });
    const list = created.lists.find((l) => l.name === '临时')!;
    const moved = await applyChangelistAction(repo, { action: 'move', paths: ['a.txt'], targetId: list.id });
    expect(moved.assignments['a.txt']).toBe(list.id);

    // 撤销改动：未跟踪文件直接删除即退出 status
    rmSync(join(repo, 'a.txt'));
    const view = await getChangelists(repo);
    expect(view.assignments['a.txt']).toBeUndefined();
    // 列表本身保留
    expect(view.lists.some((l) => l.id === list.id)).toBe(true);
  });

  it('INVALID_QUERY：名重复 create / 删除默认列表 / move 到不存在列表', async () => {
    const repo = await registeredRepo();
    writeFileSync(join(repo, 'a.txt'), 'a');

    // 名重复（含与默认列表同名）
    await expect(applyChangelistAction(repo, { action: 'create', name: '默认' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '列表已存在：默认',
    });
    await applyChangelistAction(repo, { action: 'create', name: '功能A' });
    await expect(applyChangelistAction(repo, { action: 'create', name: '功能A' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '列表已存在：功能A',
    });

    // 默认列表不可删除
    await expect(applyChangelistAction(repo, { action: 'delete', id: 'default' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '默认列表不可删除',
    });

    // move 到不存在列表
    await expect(
      applyChangelistAction(repo, { action: 'move', paths: ['a.txt'], targetId: 'no-such-list' }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY', message: '列表不存在：no-such-list' });
  });

  it('未注册 repoPath 抛 REPO_NOT_FOUND（防御）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getChangelists(repo)).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
    await expect(applyChangelistAction(repo, { action: 'create', name: 'x' })).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
    });
  });
});
