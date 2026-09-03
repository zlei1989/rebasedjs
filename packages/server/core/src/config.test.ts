/** config 原语测试：真实 git CLI + 临时仓库（local 读写回环、未设置键为 null） */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGitConfigEntries, setGitConfigLocal } from './config';
import { createTmpRepo, cleanupTmpRepo } from './testing/tmp-repo';

describe('config 原语', () => {
  let repo: string;
  beforeEach(() => { repo = createTmpRepo(); });
  afterEach(() => { cleanupTmpRepo(repo); });

  it('未设置的键 localValue 为 null（value 可能来自全局配置，不断言）', async () => {
    // fixture 已设 user.name/user.email，故用其他白名单键；全局配置可能影响 value，只断言 localValue
    const [entry] = await getGitConfigEntries(repo, ['pull.rebase']);
    expect(entry.key).toBe('pull.rebase');
    expect(entry.localValue).toBeNull();
  });

  it('setGitConfigLocal 写仓库级值：value 与 localValue 均生效', async () => {
    await setGitConfigLocal(repo, 'user.name', '张三');
    const [entry] = await getGitConfigEntries(repo, ['user.name']);
    expect(entry.value).toBe('张三');
    expect(entry.localValue).toBe('张三');
  });
});
