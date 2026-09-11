'use client';

/**
 * 忽略配置页容器：useIgnore + useIgnoreTemplates 注入 ui IgnoreDialog（与 web-koa 容器同构）。
 * 页面「编辑忽略规则」按钮开 Modal；onOk = usePutIgnore trigger（成功关窗——失败保持打开供重试，
 * 与组件「确认提交本身不复位」契约对应）；onCancel 关窗；confirming = isMutating。
 */
import { useIgnore, useIgnoreTemplates, usePutIgnore } from '@rebased/client';
import { IgnoreDialog, PageShell } from '@rebased/ui';
import { Button, Tooltip, message } from 'antd';
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
    <PageShell>
      {/* 返回日志页 */}
      {/* 一对一 Tooltip：说明去向（只加包裹，导航逻辑不动） */}
      {/* alignSelf: PageShell 刻意不设 alignItems，直接子项会被拉成整行宽、文字居中；就地收回内容宽（保持紧凑左对齐链接观感，原语契约不动） */}
      <Tooltip title="返回该仓库的提交日志页">
        <Button style={{ alignSelf: 'flex-start' }} type="link" onClick={() => router.push(`/repos/${repoId}`)}>
          返回日志
        </Button>
      </Tooltip>
      {/* alignSelf: 同「返回日志」——PageShell 不设 alignItems，直接子项会被拉成整行宽的填充条（本处是 primary 按钮，比链接更显眼）；就地收回内容宽 */}
      <Tooltip title="打开忽略规则编辑器：选 .gitignore 或 .git/info/exclude 编辑规则，确认后写盘">
        <Button style={{ alignSelf: 'flex-start' }} type="primary" data-testid="edit-ignore-button" onClick={() => setOpen(true)}>
          编辑忽略规则
        </Button>
      </Tooltip>
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
    </PageShell>
  );
}
