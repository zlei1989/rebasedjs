/**
 * 合并页容器：useBranches（MergeDialog 数据源）+ useMerge → ui MergeDialog 页面化（open 常驻 true，取消=返回日志页）
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate，而非 Next params/router）。
 * 合并结果：up-to-date → message.info「已是最新」（留页可改选）；success → message.success + 返回日志页；
 * conflicts → message.warning + 预填冲突列表 SWR 缓存（免冲突页加载闪烁）后跳冲突页。
 * 自订阅 events（与分支页一致性约定）：外部 CLI 检出/改 HEAD 时重验证分支列表；操作失败统一 message.error。
 */
import { useBranches, useMerge, useRepoEvents } from '@rebased/client';
import type { MergeBody } from '@rebased/contracts';
import { MergeDialog } from '@rebased/ui';
import { message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';

export function RepoMergePage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: branches, mutate: mutateBranches } = useBranches(repoId);
  const { trigger: merge, isMutating: merging } = useMerge(repoId);
  // 全局 mutate：conflicts 结果预填冲突列表缓存（与 useConflicts 同键，revalidate:false 防立即覆盖）
  const { mutate } = useSWRConfig();
  // 外部 CLI 检出/重命名当前分支 → repo.state-changed → 重验证分支列表（可选分支随 current 变化）
  useRepoEvents(repoId, { onStatus: () => void mutateBranches() });
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // react-router v7 navigate 可能返回 Promise：包函数体固定 void 返回
  const back = (): void => {
    void navigate(`/repos/${repoId}`);
  };
  // MergeDialog 确定：按结果三分支处理（已是最新/成功/冲突）
  const onOk = (body: MergeBody): void => {
    merge(body)
      .then((outcome) => {
        if (outcome.status === 'up-to-date') {
          void message.info('已是最新');
        } else if (outcome.status === 'success') {
          void message.success('合并完成');
          back();
        } else {
          void message.warning('存在冲突，请解决后完成合并');
          // MergeOutcome.conflicts 与 ConflictList 同形：预填缓存避免冲突页首帧加载闪烁
          void mutate(`/api/repos/${repoId}/conflicts`, { conflicts: outcome.conflicts }, { revalidate: false });
          navigate(`/repos/${repoId}/conflicts`);
        }
      })
      .catch(onError);
  };
  // 分支列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!branches) return null;
  return (
    // key=repoId：SPA 同挂载实例切换仓库时强制重挂载，对话框内选择态随之重置
    <MergeDialog key={repoId} open branches={branches} confirming={merging} onOk={onOk} onCancel={back} />
  );
}
