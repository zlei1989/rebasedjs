/**
 * 首页入库流程：mutation（打开/初始化/克隆）→ 刷新最近列表 → 跳转日志页。
 * 失败（client http 抛 ServiceError，message 为可读中文）经 antd message.error 呈现——
 * 此前容器是 void(async…) 无 catch，失败零用户反馈。（与 web-koa 同构副本）
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

/** 通用入库流程：op 为打开/初始化/克隆 mutation；failText 为兜底失败文案（服务端 message 优先） */
export async function repoMutationFlow(
  op: () => Promise<{ repoId: string }>,
  refresh: () => Promise<unknown>,
  navigate: (repoId: string) => void,
  failText: string,
): Promise<void> {
  try {
    const { repoId } = await op();
    await refresh();
    navigate(repoId);
  } catch (error) {
    void message.error(error instanceof Error ? error.message : failText);
  }
}

export async function openRepoFlow({ path, openRepo, refresh, navigate }: OpenRepoFlowDeps): Promise<void> {
  await repoMutationFlow(() => openRepo({ path }), refresh, navigate, '打开仓库失败');
}
