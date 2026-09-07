'use client';

/**
 * 差异页容器：useFileDiff（全文 FileVersions，主渲染路径）+ useDiffStream（同查询分块流，渐进渲染）+ useSettings 注入 ui。
 * 服务端 diff 端点返回 FileVersions（Monaco 两侧全文），与 client useFileDiff 类型一致。
 * 分块流与全文同参（staged/from/to 透传）：全文未就绪且流已有文本时渲染 DiffStreamView（分块文本接入 Monaco，
 * P0 消化——见任务清单 §2.1），全文到达即切换标准 DiffPage；流错误在分块视图内呈现。
 * from/to 为可选成对查询参数：committed 浏览页打开某提交的变更（from=父提交、to=提交本身）时进入；
 * from/to 存在时覆盖「worktree 对比」语义（staged 开关仅 worktree 模式有意义，此时隐藏切换——终审 Must-fix 3）。
 * renameFrom 为可选重命名原名（committed 页 R 状态文件附加）：透传 ui DiffPage 显示提示行（不做伪 diff）。
 * root=1（根提交无父版本）：透传 ui DiffPage 显示提示行；不传 from/to（to-only 会被端点 XOR 校验拒绝）。
 */
import { useDiffStream, useFileDiff, useSettings } from '@rebased/client';
import { DiffPage, DiffStreamView } from '@rebased/ui';
import { Typography } from 'antd';
import { use, useState } from 'react';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ file?: string; from?: string; to?: string; renameFrom?: string; root?: string }>;
}): React.ReactNode {
  const { repoId } = use(params);
  const { file = '', from, to, renameFrom, root } = use(searchParams);
  const isRoot = root === '1';
  const [staged, setStaged] = useState(false);
  const { data: versions, error } = useFileDiff(repoId, file, staged, isRoot ? undefined : from, isRoot ? undefined : to);
  // 分块订阅：与全文查询同参（渐进渲染，Ruling 6）；text/error 驱动 DiffStreamView
  const { text: streamText, error: streamError, connected: streamConnected } = useDiffStream(
    repoId,
    file,
    staged,
    isRoot ? undefined : from,
    isRoot ? undefined : to,
  );
  // 预取设置（logInEditor 等偏好供后续页面接线）
  useSettings();
  // 缺 file 或数据未就绪时不渲染主体
  if (!file) return null;
  // 加载失败显式呈现（如 committed 打开路径损坏等端点 GIT_ERROR）；根提交提示行不依赖数据，跳过错误分支
  if (!isRoot && error) return <Typography.Text type="danger" data-testid="diff-error">{error.message}</Typography.Text>;
  // 全文未就绪：流已有文本 → 分块视图渐进渲染（分块文本接入 Monaco）；否则等待
  if (!isRoot && !versions) {
    return streamText !== '' ? (
      <DiffStreamView text={streamText} error={streamError} connected={streamConnected} />
    ) : null;
  }
  return (
    <DiffPage
      versions={versions ?? { before: '', after: '' }}
      file={file}
      staged={staged}
      onToggleStaged={setStaged}
      renameFrom={renameFrom}
      rootCommit={isRoot}
      fromTo={from !== undefined && to !== undefined}
    />
  );
}
