/**
 * 差异页：文件路径头（含同组文件的「上一个 / 下一个」）+ DiffViewer（工具条选项各自记本机：
 * 并排/行内、忽略空白、自动换行、空白字符、上下文行数；staged/工作区切换）。
 * UX 对齐 #4。staged 由调用方受控（影响服务端取数三态映射）；ignoreWhitespace 与其它呈现选项
 * 都是**显示偏好**，由 DiffViewer 自持并逐项落 localStorage（见 domain/diff-viewer 文件头）。
 * 三版本模式（threeWayVersions 提供时）：HEAD/暂存/工作区三侧两段对比（GitStageCompareThreeVersionsAction）。
 * 特殊模式（终审裁定）：
 * - renameFrom 非空（committed 浏览 R 重命名文件时容器经 ?renameFrom= 带入原名）：只渲染提示行，
 *   不做 Monaco 伪 diff——两侧文件名不同，单文件并行对比会误读为「全新增」，提示行引导到历史页查重命名；
 * - rootCommit（根提交无父版本）：from=<hash>~1 无父可解析，同样只渲染提示行；
 * - fromTo 为 true（定提交对比）：透传 DiffViewer 隐藏 staged/工作区切换（与 from/to 互斥，服务端 400）。
 */
import type { FileThreeVersions, FileVersions } from '@rebased/contracts';
import { Flex, Typography } from 'antd';
import { PageShell } from '../base/page-shell';
import { DiffViewer } from '../domain/diff-viewer';
import { FileNavButtons } from '../domain/file-nav-buttons';
import { languageForPath } from '../domain/language';
import { ThreeWayView } from './three-way-view';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';

export interface DiffPageProps {
  versions: FileVersions;
  /** 三版本对比数据（HEAD/暂存/工作区）；提供时渲染三版本视图（与 versions 二选一） */
  threeWayVersions?: FileThreeVersions;
  /** 当前对比文件路径（页头展示，未显式传 language 时也用它推断语法高亮） */
  file: string;
  staged: boolean;
  onToggleStaged?: (staged: boolean) => void;
  /** 显式语言 id；缺省按 file 扩展名推断（见 domain/language） */
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

export function DiffPage({
  versions,
  threeWayVersions,
  file,
  staged,
  onToggleStaged,
  language,
  renameFrom,
  rootCommit,
  fromTo,
  loader,
  files,
  onNavigateFile,
}: DiffPageProps): React.ReactNode {
  // 语法高亮：容器通常只给文件路径，语言 id 在这里按扩展名推断（与 log-page 内联快照同一套口径）；
  // 缺省 plaintext 时 diff 两侧只有单调文本色，等于没有高亮
  const highlightLanguage = language ?? languageForPath(file);
  // 页面根：/repos/:repoId/diff 直接渲染本组件（无外层布局根），故由本组件持有密度（不传 density=compact）。
  // gap/padding 照抄既有值 8（PageShell 默认不落 style，不传会静默丢掉内距与行距）。
  return (
    <PageShell gap={8} padding={8}>
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
            language={highlightLanguage}
            fromTo={fromTo}
            loader={loader}
          />
        </div>
      )}
    </PageShell>
  );
}
