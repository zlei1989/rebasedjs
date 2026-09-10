import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitExecutableInfo, getSettings, updateSettings } from './settings';

let configDir: string;

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'rebased-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

describe('settings', () => {
  it('默认 logInEditor=true，recentRepoIds 为空，保护分支模式为空列表，主题为暗色', () => {
    expect(getSettings()).toEqual({ logInEditor: true, recentRepoIds: [], protectedBranchPatterns: [], theme: 'dark' });
  });

  it('updateSettings 部分更新并持久化（保护分支模式独立补丁）', () => {
    updateSettings({ logInEditor: false });
    expect(getSettings().logInEditor).toBe(false);
    updateSettings({ recentRepoIds: ['r1'] });
    expect(getSettings()).toEqual({ logInEditor: false, recentRepoIds: ['r1'], protectedBranchPatterns: [], theme: 'dark' });
    updateSettings({ protectedBranchPatterns: ['^main$', '^release/'] });
    expect(getSettings().protectedBranchPatterns).toEqual(['^main$', '^release/']);
  });

  it('主题补丁写入并持久化（light/dark 二值）', () => {
    updateSettings({ theme: 'light' });
    expect(getSettings().theme).toBe('light');
    // 与既有补丁合并而非重置其他字段
    expect(getSettings().logInEditor).toBe(false);
    updateSettings({ theme: 'dark' });
    expect(getSettings().theme).toBe('dark');
  });

  it('旧配置缺 protectedBranchPatterns/theme → 归一化补空列表与暗色', () => {
    // 之前轮次的配置文件没有该字段（settings 残留旧形状）
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({ repos: [], settings: { logInEditor: true, recentRepoIds: [] } }),
      'utf8',
    );
    expect(getSettings()).toEqual({ logInEditor: true, recentRepoIds: [], protectedBranchPatterns: [], theme: 'dark' });
    // 清除测试残留，恢复默认
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({ repos: [], settings: { logInEditor: true, recentRepoIds: [] } }), 'utf8');
  });

  it('非法正则模式 → INVALID_QUERY（Pattern.compile 语义）', () => {
    expect(() => updateSettings({ protectedBranchPatterns: ['^main$', '(['] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUERY', message: '保护分支模式不是有效正则：([' }),
    );
  });

  it('getGitExecutableInfo：本机 PATH git 可执行 → ok 且版本可解析', async () => {
    const info = await getGitExecutableInfo();

    expect(info.exec).toBe('git');
    expect(info.ok).toBe(true);
    expect(info.version).toMatch(/^git version \S+/);
  });
});
