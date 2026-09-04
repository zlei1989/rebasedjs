/**
 * 远程页容器：useRemotes + useRemoteAction + useFetch 注入 ui RemotePanel（与 web-next 容器同构；
 * repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。操作失败经 message.error 呈现
 * （成功响应由 useRemoteAction 显式回写 remotes 缓存）。
 * 本页不自订阅 events：fetch/add 引起的 ahead/behind 与引用变化由事件推送驱动日志页刷新，
 * 远程列表自身不经 watcher 事件变化（远程配置不属于 refs/status 指纹）。
 */
import { useFetch, useRemoteAction, useRemotes } from '@rebased/client';
import { RemotePanel } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoRemotesPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: remotes } = useRemotes(repoId);
  const { trigger: remoteAction, isMutating: acting } = useRemoteAction(repoId);
  const { trigger: fetchTrigger, isMutating: fetching } = useFetch(repoId);
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 远程列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!remotes) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <RemotePanel
        key={repoId}
        remotes={remotes}
        onAction={(action) => {
          remoteAction(action).catch(onError);
        }}
        onFetch={(remote) => {
          // fetch 结果仅作提示（更新 N 个引用）；引用/状态变化经 refs.changed 等事件推送刷新
          fetchTrigger(remote !== undefined ? { remote } : undefined)
            .then((result) => void message.success(`fetch 完成，更新 ${result.updatedRefs.length} 个引用`))
            .catch(onError);
        }}
        acting={acting || fetching}
      />
    </Flex>
  );
}
