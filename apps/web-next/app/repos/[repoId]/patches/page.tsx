'use client';

/**
 * 补丁页容器：usePatches + useCreatePatch/useApplyPatch/useDeletePatch/useImportPatchIntoShelf 注入 ui PatchPanel（与 web-koa 容器同构）。
 * 顶部返回按钮回日志页；操作失败统一 message.error（成功响应由 hooks 显式回写 patches/shelf/status 缓存键，无需额外刷新）；
 * acting 并合四个 mutation 的 isMutating：任一进行中即禁用行按钮/创建按钮 loading。
 */
import { useApplyPatch, useCreatePatch, useDeletePatch, useImportPatchIntoShelf, usePatches } from '@rebased/client';
import { PatchPanel } from '@rebased/ui';
import { Button, Flex, Tooltip, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: patches } = usePatches(repoId);
  const { trigger: createPatch, isMutating: creating } = useCreatePatch(repoId);
  const { trigger: applyPatch, isMutating: applying } = useApplyPatch(repoId);
  const { trigger: deletePatch, isMutating: deleting } = useDeletePatch(repoId);
  const { trigger: importShelf, isMutating: importing } = useImportPatchIntoShelf(repoId);
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 补丁列表未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!patches) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载，面板内 Modal/确认态随之重置 */}
      <PatchPanel
        key={repoId}
        patches={patches}
        onCreate={(body) => {
          createPatch(body).catch(onError);
        }}
        onApply={(name) => {
          applyPatch({ name }).catch(onError);
        }}
        onImportShelf={(name) => {
          // ImportIntoShelfAction:74 activateView → 切到 Shelf 视图；Web 等价 = 成功后跳搁置页
          importShelf({ name })
            .then(() => {
              void message.success(`已导入搁置：${name}`);
              router.push(`/repos/${repoId}/shelves`);
            })
            .catch(onError);
        }}
        onDelete={(name) => {
          deletePatch({ name }).catch(onError);
        }}
        acting={creating || applying || deleting || importing}
      />
    </Flex>
  );
}
