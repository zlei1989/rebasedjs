/**
 * 子模块页容器：useSubmodules + useUpdateSubmodules（同键回写）注入 ui SubmodulePanel
 * （与 web-next 容器同构；repoId 取 useParams、返回导航用 useNavigate）。
 * onUpdate 透传面板构造的请求体：行内 {name}；全量非递归 {}；全量递归 {recursive:true}（T5 裁定）。
 * 顶部返回按钮回日志页；「刷新」重取列表（mutate）；操作失败统一以服务端中文 message 提示。
 */
import { useSubmodules, useUpdateSubmodules } from '@rebased/client';
import { SubmodulePanel } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

export function RepoSubmodulesPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const { data: submodules, error: submodulesError, mutate: mutateSubmodules } = useSubmodules(repoId);
  const { trigger: updateSubmodules, isMutating: updating } = useUpdateSubmodules(repoId);
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection（既有容器做法）
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 页面级查询错误一次性呈现
  useEffect(() => {
    if (submodulesError !== undefined) void message.error(submodulesError instanceof Error ? submodulesError.message : String(submodulesError));
  }, [submodulesError]);
  // 列表未就绪前不渲染主体（加载态壳层后续任务再补；失败已 toast，面板不可用时静默）
  if (!submodules) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => navigate(`/repos/${repoId}`)}>
        返回日志
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Checkbox 态随之重置 */}
      <SubmodulePanel
        key={repoId}
        submodules={submodules}
        onUpdate={(body) => {
          updateSubmodules(body)
            .then(() => void message.success('子模块已更新'))
            .catch(onError);
        }}
        acting={updating}
        onRefresh={() => void mutateSubmodules()}
      />
    </Flex>
  );
}
