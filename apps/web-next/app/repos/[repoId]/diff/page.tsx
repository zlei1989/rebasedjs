'use client';

/**
 * 差异页容器：useFileDiff + useDiffStream + useSettings 注入 ui DiffPage。
 * 服务端 diff 端点返回 FileVersions（Monaco 两侧全文），client 的 useFileDiff 类型标注 DiffFile
 * 为 Task 5 遗留偏差（同 URL），此处按端点实际形状取数，类型对齐留待后续任务。
 */
import { useDiffStream, useFileDiff, useSettings } from '@rebased/client';
import type { FileVersions } from '@rebased/contracts';
import { DiffPage } from '@rebased/ui';
import { use, useState } from 'react';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ repoId: string }>;
  searchParams: Promise<{ file?: string }>;
}): React.ReactNode {
  const { repoId } = use(params);
  const { file = '' } = use(searchParams);
  const [staged, setStaged] = useState(false);
  const { data } = useFileDiff(repoId, file, staged);
  // 订阅 SSE 分块流（保活/预热；分块文本的 UI 呈现留待后续任务）
  useDiffStream(repoId, file);
  // 预取设置（logInEditor 等偏好供后续页面接线）
  useSettings();
  const versions = data as unknown as FileVersions | undefined;
  // 缺 file 或数据未就绪时不渲染主体
  if (!file || !versions) return null;
  return <DiffPage versions={versions} file={file} staged={staged} onToggleStaged={setStaged} />;
}
