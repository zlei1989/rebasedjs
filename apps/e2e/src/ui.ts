/**
 * e2e 页面操作助手（轻量 page-objects）。
 * 选择器对齐实际渲染（写死自读代码时的快照）：
 * - RepoPage 打开表单（packages/client/ui/src/composite/repo-page.tsx）：Input placeholder「仓库路径」、
 *   提交按钮文字「打开」——二者均无 data-testid，用文本/占位符定位；
 * - LogPage 顶栏 icon 按钮（packages/client/ui/src/composite/log-page.tsx）走 aria-label
 *   （撤销最近提交/变更/分支/合并/贮藏/设置/更多），提交行 data-testid="commit-graph-row"
 *   （packages/client/ui/src/domain/commit-graph.tsx）。
 */
import { expect, type Page } from '@playwright/test';

/**
 * 「打开」按钮的可访问名：antd 对双中文字符按钮内容自动插入空格（实际渲染为「打 开」），
 * 故用正则（零或一个空格）兼容两种形态。
 */
const OPEN_BUTTON = /打\s*开/;

/** 首页：等待「打开仓库」表单就绪 */
export async function openReposPage(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByPlaceholder('仓库路径')).toBeVisible();
  await expect(page.getByRole('button', { name: OPEN_BUTTON })).toBeVisible();
}

/**
 * 打开仓库：输入路径 → 点「打开」→ 等待跳转 LogPage（/repos/<uuid>）。
 * 打开成功路径：POST /api/repos/open → 刷新最近列表 → router.push(`/repos/${repoId}`)。
 */
export async function openRepoByPath(page: Page, repoPath: string): Promise<void> {
  await openReposPage(page);
  await page.getByPlaceholder('仓库路径').fill(repoPath);
  await page.getByRole('button', { name: OPEN_BUTTON }).click();
  await expect(page).toHaveURL(/\/repos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
}

/** 日志页操作助手（本任务只覆盖只读断言，操作类后续任务扩充） */
export function logOperations(page: Page): {
  /** 断言提交图出现指定主题的提交行 */
  expectCommitMessage: (message: string) => Promise<void>;
  /** 断言顶栏指定 aria-label 按钮可见 */
  expectTopBarButton: (name: string) => Promise<void>;
} {
  return {
    async expectCommitMessage(message) {
      await expect(page.getByTestId('commit-graph-row').filter({ hasText: message }).first()).toBeVisible();
    },
    async expectTopBarButton(name) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    },
  };
}

/** 变更（状态）页操作助手：占位实现（状态/变更流属后续任务） */
export function statusOperations(page: Page): {
  open: () => Promise<void>;
} {
  return {
    async open() {
      await page.getByRole('button', { name: '变更' }).click();
      await expect(page).toHaveURL(/\/repos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/status/);
    },
  };
}
