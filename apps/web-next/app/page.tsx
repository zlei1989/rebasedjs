'use client';

/**
 * 首页容器：useRecentRepos + useOpenRepo + useInitRepo + useCloneRepo + useRemoveRepo + useAppHomeDir
 * 注入 ui RepoPage；打开/初始化/克隆成功刷新列表并跳转日志页（失败 message.error），移除成功仅刷新列表。
 * 点击最近列表项 = 与输入框「打开」同一条 openRepoFlow（校验 + 注册 + 刷新「最近」排序 + 跳转）——
 * 列表条目可能已失效（目录被删/移动），直接 push 会进到拉不到 status 的日志页白屏，故仍走打开流程取中文错误提示；
 * 打开中经 openingRepoId 传到 ui 做行内反馈与防连点。
 * 路径副文本 `~/` 相对化：homeDir 来自 GET /api/app/home-dir（浏览器端无法读 os.homedir，见 ui RepoPage）。
 */
import {
  useAppHomeDir,
  useCloneRepo,
  useInitRepo,
  useOpenRepo,
  useRecentRepos,
  useRemoveRepo,
} from '@rebased/client';
import { RepoPage } from '@rebased/ui';
import { message } from 'antd';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { openRepoFlow, repoMutationFlow } from '../src/open-repo-flow';

export default function Page(): React.ReactNode {
  const router = useRouter();
  const { data: repos = [], mutate } = useRecentRepos();
  const { trigger: openRepo } = useOpenRepo();
  const { trigger: initRepo, isMutating: initializing } = useInitRepo();
  const { trigger: cloneRepo, isMutating: cloning } = useCloneRepo();
  const { trigger: removeRepo } = useRemoveRepo();
  const { data: appInfo } = useAppHomeDir();
  /** 打开中的仓库 id（null=空闲）：打开含 POST 往返 + 配置落盘 + 最近列表刷新有耗时，行内加载态即时反馈并忽略再次点击 */
  const [openingRepoId, setOpeningRepoId] = useState<string | null>(null);
  return (
    <RepoPage
      repos={repos}
      homeDir={appInfo?.homeDir}
      cloning={cloning}
      initializing={initializing}
      openingRepoId={openingRepoId ?? undefined}
      onOpenRepo={(repo) => {
        setOpeningRepoId(repo.id);
        // 成功即跳转（组件随之卸载），失败已由 openRepoFlow 弹中文 message；finally 保证加载态复位
        void openRepoFlow({
          path: repo.path,
          openRepo,
          refresh: () => mutate(),
          navigate: (repoId) => router.push(`/repos/${repoId}`),
          // 复位只认自己这一单：A 打开途中点了 B 时，A 的 finally 不得提前清掉 B 的「打开中」
        }).finally(() => setOpeningRepoId((current) => (current === repo.id ? null : current)));
      }}
      onOpen={(path) => {
        void openRepoFlow({
          path,
          openRepo,
          refresh: () => mutate(),
          navigate: (repoId) => router.push(`/repos/${repoId}`),
        });
      }}
      onInit={(path) => {
        void repoMutationFlow(() => initRepo({ path }), () => mutate(), (repoId) => router.push(`/repos/${repoId}`), '初始化仓库失败');
      }}
      onClone={(url, targetDir) => {
        void repoMutationFlow(() => cloneRepo({ url, targetDir }), () => mutate(), (repoId) => router.push(`/repos/${repoId}`), '克隆仓库失败');
      }}
      onRemove={(repoId) => {
        void removeRepo(repoId)
          .then(() => mutate())
          .catch((err: unknown) => {
            // 移除失败以服务端中文 message 提示（成功路径由 mutate 刷新列表）
            void message.error(err instanceof Error ? err.message : '移除失败');
          });
      }}
      onOpenSettings={(repoId) => {
        // 欢迎屏 Configure → SettingsPage 入口（#3）：以最近仓库进入设置页（设置按仓库 git 配置呈现）
        router.push(`/repos/${repoId}/settings`);
      }}
    />
  );
}
