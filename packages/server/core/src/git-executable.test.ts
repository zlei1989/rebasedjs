/** git 可执行文件检测原语测试：本机 PATH 的 git --version 可解析（GitExecutableSelectorPanel 语义）。 */
import { describe, expect, it } from 'vitest';
import { resolveGitExecutableInfo } from './exec';

describe('resolveGitExecutableInfo', () => {
  it('PATH 中 git 可执行：ok=true 且 version 以 "git version" 开头', async () => {
    const info = await resolveGitExecutableInfo();

    expect(info.exec).toBe('git');
    expect(info.ok).toBe(true);
    expect(info.version).toMatch(/^git version \S+/);
  });
});
