/** config 服务测试：真实 git CLI + 临时仓库，验证 core→契约薄映射（白名单全量键、写后刷新视图）。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_KEYS } from '@rebased/contracts';
import { getRepoConfig, setRepoConfig } from './config';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

describe('config 服务', () => {
  let repo: string;
  beforeEach(() => { repo = createTmpRepo(); });
  afterEach(() => { cleanupTmpRepo(repo); });

  it('getRepoConfig 返回全量白名单键', async () => {
    const view = await getRepoConfig(repo);
    expect(view.entries).toHaveLength(CONFIG_KEYS.length);
    expect(view.entries.map((e) => e.key).sort()).toEqual([...CONFIG_KEYS].sort());
  });

  it('setRepoConfig 写 local 后返回刷新视图（value 与 localValue 均生效）', async () => {
    const view = await setRepoConfig(repo, { key: 'user.email', value: 'a@b.c' });
    const entry = view.entries.find((e) => e.key === 'user.email');
    expect(entry?.value).toBe('a@b.c');
    expect(entry?.localValue).toBe('a@b.c');
  });
});
