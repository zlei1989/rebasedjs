import { test, expect } from '@playwright/test';
import { createTmpRepo } from '../src/repo-fixture';
import { logOperations, openRepoByPath } from '../src/ui';

test.describe('打开仓库流', () => {
  test('打开本地仓库 → 日志页渲染最近提交与顶栏入口', async ({ page }) => {
    const repo = createTmpRepo();
    try {
      await openRepoByPath(page, repo.repoPath);

      // LogPage：顶栏仓库名 + 最近提交标题（初始提交同时可见，证明两条提交都渲染）
      await expect(page.getByText(repo.name, { exact: true })).toBeVisible();
      const log = logOperations(page);
      await log.expectCommitMessage(repo.headMessage);
      await log.expectCommitMessage(repo.initialMessage);

      // 顶栏按钮（aria-label 定位）：变更/分支/合并/贮藏/设置 + 「更多」收敛入口
      for (const btn of ['变更', '分支', '合并', '贮藏', '设置', '更多'] as const) {
        await log.expectTopBarButton(btn);
      }
    } finally {
      repo.cleanup();
    }
  });
});
