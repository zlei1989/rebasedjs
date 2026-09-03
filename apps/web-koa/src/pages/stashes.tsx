/**
 * 贮藏页容器：useStashes + useStashAction 注入 ui StashPanel（与 web-next 容器同构；
 * repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。操作失败经 message.error 呈现
 * （成功响应由 useStashAction 显式回写 stashes 缓存）；本页自订阅 events：外部 CLI 保存/应用/弹出贮藏时
 * 工作区 entries 变化 → repo.state-changed → 重验证贮藏列表（纯 drop/建删不改 RepoStatus 字段时
 * watcher 不产事件，见行内订阅注释）。
 */
import { useStashAction, useStashes, useRepoEvents } from '@rebased/client';
import { StashPanel } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoStashesPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: stashes, mutate: mutateStashes } = useStashes(repoId);
  const { trigger: stashAction, isMutating: acting } = useStashAction(repoId);
  // 外部 CLI 保存/应用/弹出贮藏 → 工作区 entries 变化 → repo.state-changed → 重验证贮藏列表；
  // 注：纯 git stash drop 不改 RepoStatus 字段，watcher 不产事件（watcher 架构的已知局限，已登记 P3 缺口），
  // 该场景依赖 SWR revalidate-on-mount/focus 兜底
  useRepoEvents(repoId, { onStatus: () => void mutateStashes() });
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 贮藏列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!stashes) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <StashPanel
        key={repoId}
        stashes={stashes}
        onAction={(action) => {
          stashAction(action).catch(onError);
        }}
        acting={acting}
      />
    </Flex>
  );
}
