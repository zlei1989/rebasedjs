/**
 * 差异页：文件路径头 + DiffViewer（默认并排、忽略空白开关默认不忽略、staged/工作区切换）。
 * UX 对齐 #4。ignoreWhitespace 为页面内部状态（默认 false，对齐 Java DEFAULT），切换时通知调用方；
 * staged 由调用方受控（影响服务端取数三态映射）。
 * 三版本模式（threeWayVersions 提供时）：HEAD/暂存/工作区三侧两段对比（GitStageCompareThreeVersionsAction）。
 * 特殊模式（终审裁定）：
 * - renameFrom 非空（committed 浏览 R 重命名文件时容器经 ?renameFrom= 带入原名）：只渲染提示行，
 *   不做 Monaco 伪 diff——两侧文件名不同，单文件并行对比会误读为「全新增」，提示行引导到历史页查重命名；
 * - rootCommit（根提交无父版本）：from=<hash>~1 无父可解析，同样只渲染提示行；
 * - fromTo 为 true（定提交对比）：透传 DiffViewer 隐藏 staged/工作区切换（与 from/to 互斥，服务端 400）。
 */
import { useState } from 'react';
import type { FileThreeVersions, FileVersions } from '@rebased/contracts';
import { Button, Flex, Tooltip, Typography } from 'antd';
import { DiffViewer } from '../domain/diff-viewer';
import { ThreeWayView } from './three-way-view';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';

export interface DiffPageProps {
  versions: FileVersions;
  /** 三版本对比数据（HEAD/暂存/工作区）；提供时渲染三版本视图（与 versions 二选一） */
  threeWayVersions?: FileThreeVersions;
  /** 当前对比文件路径（页头展示） */
  file: string;
  staged: boolean;
  onToggleStaged?: (staged: boolean) => void;
  onToggleWhitespace?: (ignoreWhitespace: boolean) => void;
  language?: string;
  /** 重命名原名（committed 页 R 状态文件打开时由容器注入）；非空时页面仅显示提示行 */
  renameFrom?: string;
  /** 根提交标记（无父版本，容器经 ?root=1 注入）；true 时页面仅显示提示行 */
  rootCommit?: boolean;
  /** 定提交对比模式（from/to 存在时容器注入）；透传 DiffViewer 隐藏 staged/工作区切换 */
  fromTo?: boolean;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
  /** 同组文件列表（多文件 Prev/Next——#27 语义：StatusPage/committed 等入口注入文件组）；缺省不渲染切换按钮 */
  files?: string[];
  /** 切换文件回调（Prev/Next 按钮；容器据此换 URL file 并保持其他查询参数） */
  onNavigateFile?: (file: string) => void;
}

/** 多文件 Prev/Next 按钮（#27）：当前索引由 file 定位；到头/尾禁用；<2 个不渲染 */
function FileNavButtons({
  files,
  file,
  onNavigateFile,
}: {
  files: string[];
  file: string;
  onNavigateFile?: (file: string) => void;
}): React.ReactNode {
  if (files.length < 2 || onNavigateFile === undefined) return null;
  const index = files.indexOf(file);
  if (index < 0) return null; // 当前文件不在组内（如过期 URL）→ 不渲染导航
  const prev = index > 0 ? files[index - 1] : undefined;
  const next = index < files.length - 1 ? files[index + 1] : undefined;
  return (
    <Flex gap={8} align="center" data-testid="diff-file-nav">
      {/* 到头/到尾时按钮禁用，禁用按钮不派发 hover → 在 Tooltip 与 Button 之间包一层 span 承接提示；
          inline-flex 让 span 紧贴按钮，不改变这一行的布局尺寸 */}
      <Tooltip title={prev === undefined ? '当前文件已是该组第一个，没有上一个可切' : '切到同组的上一个文件（保留当前对比模式）'}>
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            disabled={prev === undefined}
            data-testid="diff-prev-file"
            onClick={() => prev !== undefined && onNavigateFile(prev)}
          >
            ‹ Prev
          </Button>
        </span>
      </Tooltip>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {index + 1}/{files.length}
      </Typography.Text>
      <Tooltip title={next === undefined ? '当前文件已是该组最后一个，没有下一个可切' : '切到同组的下一个文件（保留当前对比模式）'}>
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            disabled={next === undefined}
            data-testid="diff-next-file"
            onClick={() => next !== undefined && onNavigateFile(next)}
          >
            Next ›
          </Button>
        </span>
      </Tooltip>
    </Flex>
  );
}

export function DiffPage({
  versions,
  threeWayVersions,
  file,
  staged,
  onToggleStaged,
  onToggleWhitespace,
  language,
  renameFrom,
  rootCommit,
  fromTo,
  loader,
  files,
  onNavigateFile,
}: DiffPageProps): React.ReactNode {
  // 忽略空白默认关（UX 对齐 #4：对齐 Java TextDiffSettingsHolder 默认不忽略）
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', padding: 8 }}>
      <Flex align="center" gap={16}>
        <div style={{ fontWeight: 600 }}>{file}</div>
        <FileNavButtons files={files ?? []} file={file} onNavigateFile={onNavigateFile} />
      </Flex>
      {threeWayVersions !== undefined ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ThreeWayView versions={threeWayVersions} file={file} loader={loader} />
        </div>
      ) : renameFrom ? (
        <Typography.Text type="secondary" data-testid="diff-rename-hint">
          该变更涉及重命名：{renameFrom} → {file}（改名前的历史请到「历史」页查看）
        </Typography.Text>
      ) : rootCommit ? (
        <Typography.Text type="secondary" data-testid="diff-root-hint">
          该提交为根提交（无父版本），无法按父级对比变更；文件内容即该提交引入的初始内容
        </Typography.Text>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <DiffViewer
            versions={versions}
            staged={staged}
            onToggleStaged={onToggleStaged}
            ignoreWhitespace={ignoreWhitespace}
            onToggleWhitespace={(v) => {
              setIgnoreWhitespace(v);
              onToggleWhitespace?.(v);
            }}
            language={language}
            fromTo={fromTo}
            loader={loader}
          />
        </div>
      )}
    </div>
  );
}
