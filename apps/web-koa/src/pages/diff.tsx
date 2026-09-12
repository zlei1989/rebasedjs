/**
 * 差异页容器：useFileDiff（全文 FileVersions，主渲染路径）+ useDiffStream（同查询分块流，渐进渲染）+ useSettings 注入 ui
 * （与 web-next 容器同构；repoId 取 useParams、file/from/to/renameFrom/root/files 取 useSearchParams，而非 Next params/searchParams）。
 * 三版本模式（?three=1，StatusPage 行「三版本」入口）：改用 useFileThreeWay（HEAD/暂存/工作区三侧）→ DiffPage threeWayVersions。
 * 服务端 diff 端点返回 FileVersions（Monaco 两侧全文），与 client useFileDiff 类型一致。
 * 分块流与全文同参（staged/from/to 透传）：全文未就绪且流已有文本时渲染 DiffStreamView（分块文本接入 Monaco，
 * P0 消化——见任务清单 §2.1），全文到达即切换标准 DiffPage；流错误在分块视图内呈现。
 * from/to 为可选成对查询参数：committed 浏览页打开某提交的变更（from=父提交、to=提交本身）时进入；
 * from/to 存在时覆盖「worktree 对比」语义（staged 开关仅 worktree 模式有意义，此时隐藏切换——终审 Must-fix 3）。
 * renameFrom 为可选重命名原名（committed 页 R 状态文件附加）：透传 ui DiffPage 显示提示行（不做伪 diff）。
 * root=1（根提交无父版本）：透传 ui DiffPage 显示提示行；不传 from/to（to-only 会被端点 XOR 校验拒绝）。
 * files 为可选 JSON 数组（#27 多文件 Prev/Next）：同组文件列表经 JSON.stringify 编码进查询串；切换文件保留
 * from/to/staged/three 等参数（renameFrom/root 为条目级属性，切换时清除）。
 */
import { useDiffStream, useFileDiff, useFileThreeWay, useSettings } from '@rebased/client';
import { DiffPage, DiffStreamView, PageShell } from '@rebased/ui';
import { Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

/** files 查询参数解析：JSON.stringify(string[]) 编码（逗号/管道在 git 文件名合法，JSON 免分隔冲突）；非法 → undefined */
function parseFilesParam(raw: string | null): string[] | undefined {
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((f) => typeof f === 'string') ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

export function RepoDiffPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const file = searchParams.get('file') ?? '';
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const renameFrom = searchParams.get('renameFrom') ?? undefined;
  const isRoot = searchParams.get('root') === '1';
  const isThreeWay = searchParams.get('three') === '1';
  const files = useMemo(() => parseFilesParam(searchParams.get('files')), [searchParams]);
  // staged 初值来自查询参数（StatusPage 行双击按该行所属分组带入 staged=1——三态映射的入口语义）；
  // 后续切换仍由页内 Segmented 驱动本地态，不回写 URL
  const [staged, setStaged] = useState(searchParams.get('staged') === '1');
  const { data: versions, error } = useFileDiff(repoId, file, staged, isRoot ? undefined : from, isRoot ? undefined : to);
  // 三版本数据（?three=1 时启用；与 useFileDiff 并存——SWR 键不同互不干扰）
  const { data: threeWayVersions, error: threeWayError } = useFileThreeWay(repoId, isThreeWay ? file : '');
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
  const loadError = isThreeWay ? threeWayError : error;
  // 错误态也要有**密度归属**：本分支在 DiffPage/DiffStreamView 之前提前返回，若不自己带一层
  // PageShell，这一页会整页落回 antd 默认 14px（与该路由正常态的 12px 不一致）
  if (!isRoot && loadError) {
    return (
      <PageShell>
        <Typography.Text type="danger" data-testid="diff-error">{loadError.message}</Typography.Text>
      </PageShell>
    );
  }
  if (isThreeWay) {
    if (!threeWayVersions) return null;
    return <DiffPage versions={{ before: '', after: '' }} threeWayVersions={threeWayVersions} file={file} staged={staged} />;
  }
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
      files={files}
      onNavigateFile={(next) => {
        // #27 多文件切换：换 file 保留组参数（from/to/staged/three/files）；renameFrom/root 为条目级属性，切换即清除
        const params = new URLSearchParams(searchParams.toString());
        params.set('file', next);
        params.delete('renameFrom');
        params.delete('root');
        void navigate(`/repos/${repoId}/diff?${params.toString()}`);
      }}
    />
  );
}
