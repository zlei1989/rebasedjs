import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyChangelistAction, getChangelists } from './changelist';
import { loadConfig, saveConfig } from './lib/config-store';
import { openRepo } from './repo';
import { getSettings, updateSettings } from './settings';
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

  it('读路径写回不覆盖 await 期间的并发配置修改（终审竞态修复）', async () => {
    const repo = await registeredRepo();
    // 首次读取触发 fresh 回写；回写发生在 await getRepoStatus 之后——在其间并发改 settings。
    // getChangelists 同步段（loadConfig → 调起 getRepoStatus）执行完才让出事件循环，
    // 紧接的 updateSettings 同步落盘，必落在其 await 窗口内，构造确定性竞态
    const pending = getChangelists(repo);
    updateSettings({ logInEditor: false });
    const view = await pending;

    expect(view.lists).toEqual([{ id: 'default', name: '默认', isDefault: true }]);
    // 过期整体写会把 settings 覆盖回 true；合并写回应保留并发修改
    expect(getSettings().logInEditor).toBe(false);
    // 簿记初始化本身也已落盘
    const info = await openRepo(repo);
    expect(loadConfig().changelists?.[info.id]?.lists[0]?.id).toBe('default');
  });

  it('手改损坏的 changelists 字段自愈：非对象/无 lists 数组当作无簿记初始化', async () => {
    const repo = await registeredRepo();
    const info = await openRepo(repo);

    // 损坏①：changelists 整体不是对象
    const c1 = loadConfig();
    c1.changelists = 'garbage' as never;
    saveConfig(c1);
    const v1 = await getChangelists(repo);
    expect(v1.lists).toEqual([{ id: 'default', name: '默认', isDefault: true }]);

    // 损坏②：单仓库簿记 lists 不是数组
    const c2 = loadConfig();
    c2.changelists = { [info.id]: { lists: 'nope' } } as never;
    saveConfig(c2);
    const v2 = await getChangelists(repo);
    expect(v2.lists).toEqual([{ id: 'default', name: '默认', isDefault: true }]);
    expect(v2.assignments).toEqual({});
  });
});
