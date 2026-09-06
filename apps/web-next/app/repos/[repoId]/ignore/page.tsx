'use client';

/**
 * 忽略配置页容器：useIgnore + useIgnoreTemplates 注入 ui IgnoreDialog（与 web-koa 容器同构）。
 * 页面「编辑忽略规则」按钮开 Modal；onOk = usePutIgnore trigger（成功关窗——失败保持打开供重试，
 * 与组件「确认提交本身不复位」契约对应）；onCancel 关窗；confirming = isMutating。
 */
import { useIgnore, useIgnoreTemplates, usePutIgnore } from '@rebased/client';
import { IgnoreDialog } from '@rebased/ui';
import { Button, Flex, message } from 'antd';
import { useRouter } from 'next/navigation';
import { use, useEffect, useState } from 'react';

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const { data: contents } = useIgnore(repoId);
  const { data: templates } = useIgnoreTemplates(repoId);
  const { trigger: putIgnore, isMutating: saving } = usePutIgnore(repoId);
  const [open, setOpen] = useState(false);
  // 仓库切换（两端 SPA 同挂载实例复用）时关闭 Modal（dialog 内部状态由组件在开窗/关窗时自行复位）
  useEffect(() => {
    setOpen(false);
  }, [repoId]);
  // 操作失败统一以服务端中文 message 提示，避免未捕获 rejection
  const onError = (err: unknown): void => {
    void message.error(err instanceof Error ? err.message : String(err));
  };
  // 忽略配置未就绪前不渲染主体（加载态壳层后续任务再补）
  if (!contents) return null;
  return (
    <Flex vertical align="flex-start">
      {/* 返回日志页 */}
      <Button type="link" onClick={() => router.push(`/repos/${repoId}`)}>
        返回日志
      </Button>
      <Button type="primary" data-testid="edit-ignore-button" onClick={() => setOpen(true)}>
        编辑忽略规则
      </Button>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载（contents/templates 随之更新） */}
      <IgnoreDialog
        key={repoId}
        open={open}
        contents={contents}
        templates={templates ?? []}
        onOk={(target, content) => {
          // 成功关窗（响应已由 usePutIgnore 回写 ignore 缓存键）；失败保持打开，编辑内容保留供重试
          putIgnore({ target, content })
            .then(() => setOpen(false))
            .catch(onError);
        }}
        onCancel={() => setOpen(false)}
        confirming={saving}
      />
    </Flex>
  );
}
