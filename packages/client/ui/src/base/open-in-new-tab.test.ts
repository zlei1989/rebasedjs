/**
 * openInNewTab 测试：断言「新标签页 + noopener」这两个决定行为的参数，而非只断言被调用过。
 * 教训来源（同 density.test.ts 的口径）：只断言 open 被调一次，参数退化成同页跳转或具名窗口
 * （后者会让第二个文件顶掉第一个标签）都不会变红——故三个参数逐个断言。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInNewTab } from './open-in-new-tab';

describe('openInNewTab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('以 \'_blank\' + noopener 打开给定 URL（相对路径原样交给浏览器解析）', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    openInNewTab('/repos/r1/diff?file=src%2Fa.ts&from=HEAD~1&to=HEAD');

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/repos/r1/diff?file=src%2Fa.ts&from=HEAD~1&to=HEAD', '_blank', 'noopener');
  });

  it('不用具名窗口（具名会让同一标签被后续打开复用，第二次对比顶掉第一次）', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    openInNewTab('/repos/r1/diff?file=a.ts');
    openInNewTab('/repos/r1/diff?file=b.ts');

    // 两次都必须是 '_blank'：同一 name 会复用标签，两次调用的 target 相同即视为退化
    expect(open.mock.calls.map((c) => c[1])).toEqual(['_blank', '_blank']);
  });
});
