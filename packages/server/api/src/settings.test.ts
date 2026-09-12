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

  it('主题偏好补丁写入并持久化（auto/light/dark 三值）', () => {
    updateSettings({ theme: 'light' });
    expect(getSettings().theme).toBe('light');
    // 与既有补丁合并而非重置其他字段
    expect(getSettings().logInEditor).toBe(false);
    updateSettings({ theme: 'dark' });
    expect(getSettings().theme).toBe('dark');
    // 三态：auto=跟随操作系统（服务端只持久化偏好，实际明暗由浏览器端按 prefers-color-scheme 解析）
    updateSettings({ theme: 'auto' });
    expect(getSettings().theme).toBe('auto');
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

  // 冒烟 D-42（实测事故）：外部工具（PS 5.1 的 Set-Content/Out-File）会给 config.json 写 UTF-8 BOM，
  // 之前 JSON.parse 直接抛 SyntaxError → 路由层误报「请求体不是合法 JSON」的 400、全站不可用
  it('配置文件带 UTF-8 BOM 仍可正常读取（不再让全站 400）', () => {
    const file = join(configDir, 'config.json');
    writeFileSync(
      file,
      `\uFEFF${JSON.stringify({ repos: [], settings: { logInEditor: false, recentRepoIds: [], protectedBranchPatterns: [], theme: 'auto' } })}`,
      'utf8',
    );
    expect(getSettings()).toEqual({ logInEditor: false, recentRepoIds: [], protectedBranchPatterns: [], theme: 'auto' });
  });

  it('配置文件真损坏 → 抛可读中文原因的 ServiceError（而不是冒充请求体问题的 SyntaxError）', () => {
    const file = join(configDir, 'config.json');
    writeFileSync(file, '{ not json', 'utf8');
    let thrown: unknown;
    try {
      getSettings();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('配置文件不是合法 JSON');
    expect((thrown as { code?: string }).code).toBe('GIT_ERROR');
    // 复位为默认形状，避免影响后续用例与其它测试文件
    writeFileSync(file, JSON.stringify({ repos: [], settings: { logInEditor: true, recentRepoIds: [] } }), 'utf8');
  });
});
