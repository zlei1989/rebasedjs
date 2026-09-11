/**
 * 搁置页容器：useShelves + useShelfAction 注入 ui ShelfPanel（与 web-next 容器同构；
 * repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。
 * 操作失败统一 message.error（成功响应由 useShelfAction 显式回写 shelves 缓存）；
 * restore 会回放变更到工作区——useShelfAction 只回写 shelves 键，容器在成功追加刷新 status 键（经全局 mutate 重取）。
 */
import { useShelfAction, useShelves } from '@rebased/client';
import { PageShell, ShelfPanel } from '@rebased/ui';
import { Button, Tooltip, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';

export function RepoShelvesPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: shelves } = useShelves(repoId);
  const { trigger: shelfAction, isMutating: acting } = useShelfAction(repoId);
  const { mutate: mutateGlobal } = useSWRConfig();
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 搁置列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!shelves) return null;
  return (
    <PageShell>
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      {/* alignSelf: PageShell 刻意不设 alignItems，直接子项会被拉成整行宽、文字居中；就地收回内容宽（保持紧凑左对齐链接观感，原语契约不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button style={{ alignSelf: 'flex-start' }} type="link" onClick={() => navigate(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <ShelfPanel
        key={repoId}
        shelves={shelves}
        onAction={(action) => {
          // restore 会改工作区状态：useShelfAction 只回写 shelves 键，这里补充刷新 status 键（SWR 重取）
          shelfAction(action)
            .then(() => {
              if (action.action === 'restore') void mutateGlobal(`/api/repos/${repoId}/status`);
            })
            .catch(onError);
        }}
        acting={acting}
      />
    </PageShell>
  );
}
