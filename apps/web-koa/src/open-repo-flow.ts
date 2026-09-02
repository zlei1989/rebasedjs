/**
 * 首页打开流程（终审 Finding 2 修复）：openRepo → 刷新最近列表 → 跳转日志页。
 * 打开失败（client http 抛 ServiceError，message 为可读中文）经 antd message.error 呈现——
 * 此前容器是 void(async…) 无 catch，失败零用户反馈。（与 web-next 同构副本）
 */
import { message } from 'antd';

export interface OpenRepoFlowDeps {
  /** 用户输入的仓库路径 */
  path: string;
  /** useOpenRepo().trigger */
  openRepo: (body: { path: string }) => Promise<{ repoId: string }>;
  /** useRecentRepos().mutate */
  refresh: () => Promise<unknown>;
  /** 打开成功后跳转日志页 */
  navigate: (repoId: string) => void;
}

export async function openRepoFlow({ path, openRepo, refresh, navigate }: OpenRepoFlowDeps): Promise<void> {
  try {
    const { repoId } = await openRepo({ path });
    await refresh();
    navigate(repoId);
  } catch (error) {
    void message.error(error instanceof Error ? error.message : '打开仓库失败');
  }
}
