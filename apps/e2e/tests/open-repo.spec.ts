import { test, expect } from '@playwright/test';
import { createTmpRepo } from '../src/repo-fixture';
import { logOperations, openRepoByPath } from '../src/ui';

test.describe('打开仓库流', () => {
  test('打开本地仓库 → 日志页渲染最近提交与顶栏入口', async ({ page }) => {
    const repo = createTmpRepo();
    try {
      await openRepoByPath(page, repo.repoPath);

      // 断言顺序（复审 Fix round 1）：先等数据就绪信号——提交图行（status+log 均已加载），
      // 再断言顶栏仓库名（repos 回退 UUID 竞态下取的是加载完成的最近列表），最后顶栏按钮集。
      const log = logOperations(page);
      await log.expectCommitMessage(repo.headMessage);
      await log.expectCommitMessage(repo.initialMessage);
      await expect(page.getByText(repo.name, { exact: true })).toBeVisible();

      // 顶栏按钮（aria-label 定位）：变更/分支/合并/贮藏/设置 + 「更多」收敛入口
      for (const btn of ['变更', '分支', '合并', '贮藏', '设置', '更多'] as const) {
        await log.expectTopBarButton(btn);
      }
    } finally {
      repo.cleanup();
    }
  });
});
