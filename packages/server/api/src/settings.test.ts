import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSettings, updateSettings } from './settings';

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
});
