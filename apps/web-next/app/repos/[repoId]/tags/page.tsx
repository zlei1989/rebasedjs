'use client';

/**
 * 标签页容器：useTags + useTagAction 注入 ui TagPanel（与 web-koa 容器同构）；
 * 顶部返回按钮回日志页；操作失败经 message.error 呈现（成功响应由 useTagAction 显式回写 tags 缓存）。
 * 本页自订阅 events：外部 CLI 建/删/移动标签 → refs.changed → 重验证标签列表
 * （watcher 事件覆盖面：分支/标签/贮藏/远程引用的建删与移动均产 refs.changed）。
 */
import { useRepoEvents, useTagAction, useTags } from '@rebased/client';
import { PageShell, TagPanel } from '@rebased/ui';
import { Button, Tooltip, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: tags, mutate: mutateTags } = useTags(repoId);
  const { trigger: tagAction, isMutating: acting } = useTagAction(repoId);
  // 外部 CLI 建/删/移动标签 → refs.changed → 重验证标签列表刷新（标签面板自身操作已由 useTagAction 回写缓存）
  useRepoEvents(repoId, { onRefs: () => void mutateTags() });
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 标签列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!tags) return null;
  return (
    <PageShell>
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <TagPanel
        key={repoId}
        tags={tags}
        onAction={(action) => {
          tagAction(action)
            .then(() => {
              // 远程类动作不改本地列表（「删除远程」后列表原样、「推送」成功后也只是远端多一条）——
              // 无回执会让用户以为点击没生效，故明确提示（D-27）
              if (action.action === 'deleteRemote') void message.success(`已删除远程标签 ${action.name}`);
              else if (action.action === 'push') void message.success(`标签推送完成：${action.name}`);
              else if (action.action === 'pushAll') void message.success('全部标签推送完成');
            })
            .catch(onError);
        }}
        acting={acting}
      />
    </PageShell>
  );
}
