/**
 * 差异页容器：useFileDiff + useDiffStream + useSettings 注入 ui DiffPage（与 web-next 容器同构；
 * repoId 取 useParams、file/from/to/renameFrom/root 取 useSearchParams，而非 Next params/searchParams）。
 * 服务端 diff 端点返回 FileVersions（Monaco 两侧全文），与 client useFileDiff 类型一致。
 * from/to 为可选成对查询参数：committed 浏览页打开某提交的变更（from=父提交、to=提交本身）时进入；
 * from/to 存在时覆盖「worktree 对比」语义（staged 开关仅 worktree 模式有意义，此时隐藏切换——终审 Must-fix 3）。
 * renameFrom 为可选重命名原名（committed 页 R 状态文件附加）：透传 ui DiffPage 显示提示行（不做伪 diff）。
 * root=1（根提交无父版本）：透传 ui DiffPage 显示提示行；不传 from/to（to-only 会被端点 XOR 校验拒绝）。
 */
import { useDiffStream, useFileDiff, useSettings } from '@rebased/client';
import { DiffPage } from '@rebased/ui';
import { Typography } from 'antd';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

export function RepoDiffPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const [searchParams] = useSearchParams();
  const file = searchParams.get('file') ?? '';
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const renameFrom = searchParams.get('renameFrom') ?? undefined;
  const isRoot = searchParams.get('root') === '1';
  const [staged, setStaged] = useState(false);
  const { data: versions, error } = useFileDiff(repoId, file, staged, isRoot ? undefined : from, isRoot ? undefined : to);
  // 订阅 SSE 分块流（保活/预热；分块文本的 UI 呈现留待后续任务）
  useDiffStream(repoId, file);
  // 预取设置（logInEditor 等偏好供后续页面接线）
  useSettings();
  // 缺 file 或数据未就绪时不渲染主体
  if (!file) return null;
  // 加载失败显式呈现（如 committed 打开路径损坏等端点 GIT_ERROR）；根提交提示行不依赖数据，跳过错误分支
  if (!isRoot && error) return <Typography.Text type="danger" data-testid="diff-error">{error.message}</Typography.Text>;
  if (!isRoot && !versions) return null;
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
