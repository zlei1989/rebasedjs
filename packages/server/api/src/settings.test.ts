import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitExecutableInfo, getSettings, updateSettings } from './settings';

let configDir: string;

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'rebased-config-'));
  process.env.REBASED_CONFIG_DIR = configDir;
});

describe('settings', () => {
  it('默认 logInEditor=true，recentRepoIds 为空', () => {
    expect(getSettings()).toEqual({ logInEditor: true, recentRepoIds: [] });
  });

  it('updateSettings 部分更新并持久化', () => {
    updateSettings({ logInEditor: false });
    expect(getSettings().logInEditor).toBe(false);
    updateSettings({ recentRepoIds: ['r1'] });
    expect(getSettings()).toEqual({ logInEditor: false, recentRepoIds: ['r1'] });
  });

  it('getGitExecutableInfo：本机 PATH git 可执行 → ok 且版本可解析', async () => {
    const info = await getGitExecutableInfo();

    expect(info.exec).toBe('git');
    expect(info.ok).toBe(true);
    expect(info.version).toMatch(/^git version \S+/);
  });
});
