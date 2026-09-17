/**
 * 变更集面板：日志页快照栏标签栏里「变更集」标签的两个视图——
 *   · ChangesetList：本次提交涉及的全部文件（状态徽标 + 文件名；R 显示「旧 → 新」），点文件名在同一标签栏开它的差异标签；
 *   · ChangesetDiffPane：某个变更文件的差异（路径栏 + DiffViewer，定提交对比模式 from=父提交、to=该提交）。
 * 为什么从 Modal 搬到这里：变更集是「看一份清单，再逐个看差异」的连续动作，弹窗会把日志页盖住，
 *   看完一个文件回来还得重新找那个弹窗；做成标签栏里的标签后与「文件（N）」的文件标签同一套手感
 *   （开、切、关都在一条栏上），且不额外占一层浮层。
 * 清单**不重复提交主题**（用户口径）：主题在日志行、详情面板与清单标签的 Tooltip 里都有，
 *   清单只承担「这次动了哪些文件、点谁看差异」。
 * 两个降级与差异页同口径（不做伪 diff，只给提示行）：根提交没有父版本；R 重命名两侧文件名不同，
 *   单文件并行对比会误读成「全新增」。
 * 纯展示：不调接口、不碰 URL，数据与动作全部由容器经 props 给（装配见 composite/snapshot-tabs）。
 */
import { Alert, Flex, Skeleton, Spin, Tooltip, Typography, theme } from 'antd';
import type { CommittedEntry, FileVersions } from '@rebased/contracts';
import type { ReactNode } from 'react';
import type { MonacoDiffLoader } from '../base/monaco-diff-view';
import { CommittedStatusTag } from '../domain/committed-status';
import { DiffViewer } from '../domain/diff-viewer';
import { FileNavButtons } from '../domain/file-nav-buttons';
import { languageForPath } from '../domain/language';

export interface ChangesetListProps {
  /** 该提交的变更集（容器经 useCommitFiles 条件拉取；null/undefined = 未就绪） */
  entry?: CommittedEntry | null;
  /** 变更集拉取中 */
  loading?: boolean;
  /** 变更集拉取错误信息 */
  error?: string | null;
  /** 点某个变更文件（容器把它开成 diff 标签；已开则只切过去） */
  onOpenFile?: (path: string) => void;
}

export function ChangesetList({ entry, loading, error, onOpenFile }: ChangesetListProps): ReactNode {
  if (loading === true) return <Skeleton active />;
  if (error !== undefined && error !== null) return <Alert type="error" showIcon title={error} />;
  if (entry === undefined || entry === null) {
    return <Typography.Text type="secondary">暂无变更文件</Typography.Text>;
  }
  return (
    <Flex vertical gap={8}>
      {entry.files.map((file) => (
        <Flex key={`${file.status}-${file.path}`} align="center" gap={8}>
          <CommittedStatusTag status={file.status} />
          <Tooltip title="在同一标签栏打开该文件的差异：以本提交与其父提交为两端">
            <Typography.Text
              data-testid={`changes-file-${file.path}`}
              style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
              ellipsis
              onClick={() => onOpenFile?.(file.path)}
            >
              {file.renameFrom !== undefined ? `${file.renameFrom} → ${file.path}` : file.path}
            </Typography.Text>
          </Tooltip>
        </Flex>
      ))}
    </Flex>
  );
}

export interface ChangesetDiffPaneProps {
  /** 当前差异文件路径 */
  path: string;
  /** 同组文件（该提交变更集的全部路径）：路径栏右端的「上一个 / 下一个」据此前后翻 */
  files?: string[];
  /** 切换文件回调（宿主在同一标签栏开/切那个文件的差异标签） */
  onNavigateFile?: (path: string) => void;
  /** 该文件的改名原名（R 状态）：非空只给提示行，不做伪 diff（与差异页同口径） */
  renameFrom?: string;
  /** 该提交是根提交（无父版本）：只给提示行（与差异页同口径） */
  rootCommit?: boolean;
  /** 该文件两版全文（容器经 useFileDiff 拉取；未就绪/未发请求时缺省） */
  versions?: FileVersions;
  /** 差异拉取中 */
  loading?: boolean;
  /** 差异拉取错误信息 */
  error?: string;
  /** Monaco diff 懒加载注入点（测试传 stub 绕过真实 monaco） */
  loader?: MonacoDiffLoader;
}

export function ChangesetDiffPane({
  path,
  files,
  onNavigateFile,
  renameFrom,
  rootCommit,
  versions,
  loading,
  error,
  loader,
}: ChangesetDiffPaneProps): ReactNode {
  // 分隔线走主题 token（暗色主题下硬编码浅灰会过亮），与快照栏其它表头同源
  const { token } = theme.useToken();
  /* 高度契约与文件内容标签一致：根节点 height:100%（标签页本体是块盒），**不写行内 display**——
     非激活标签页靠 antd 的 .ant-tabs-content-hidden 隐藏，行内 display 会盖掉那条规则。 */
  return (
    <Flex vertical style={{ height: '100%', minHeight: 0, minWidth: 0 }}>
      {/* 路径栏：左边是这一版／这个文件的定位信息，右边是组内「上一个 / 下一个」前后翻
          （对比的两端由路径栏 Tooltip 说明：本标签恒定是「与父提交对比」，故不再常驻一行文字；
          组内只有 1 个文件时导航仍渲染 `1/1`——本提交只动了这一个文件，比留空更有信息量） */}
      <Flex
        align="center"
        gap={8}
        style={{ padding: '4px 8px', borderBottom: `1px solid ${token.colorSplit}`, minWidth: 0 }}
      >
        <Typography.Text
          code
          data-testid="changes-diff-path"
          ellipsis={{ tooltip: `与父提交对比：${path}` }}
          style={{ minWidth: 0, flex: 1 }}
        >
          {path}
        </Typography.Text>
        <FileNavButtons files={files ?? []} file={path} onNavigateFile={onNavigateFile} showSingle />
      </Flex>
      <Flex vertical data-testid="changes-diff-body" style={{ flex: 1, minHeight: 0, minWidth: 0, padding: 8 }}>
        {body()}
      </Flex>
    </Flex>
  );

  /** 正文区：两种降级提示行优先于数据状态（它们不依赖取数），随后是错误/加载/差异视图 */
  function body(): ReactNode {
    if (rootCommit === true) {
      return (
        <Typography.Text type="secondary" data-testid="changes-diff-root-hint">
          该提交为根提交（无父版本），无法按父级对比变更；该文件的初始内容可在「文件（N）」标签里查看
        </Typography.Text>
      );
    }
    if (renameFrom !== undefined && renameFrom !== '') {
      return (
        <Typography.Text type="secondary" data-testid="changes-diff-rename-hint">
          该变更涉及重命名：{renameFrom} → {path}（改名前的历史请到「历史」页查看）
        </Typography.Text>
      );
    }
    if (error !== undefined) {
      return (
        <Typography.Text type="danger" data-testid="changes-diff-error">
          {error}
        </Typography.Text>
      );
    }
    // 未就绪与加载中同屏：容器在「变更集还没拉到 / 差异还在路上」这两种窗口里都只表达「还没好」
    if (versions === undefined || loading === true) {
      return <Spin data-testid="changes-diff-loading" />;
    }
    return (
      <div style={{ flex: 1, minHeight: 0 }}>
        <DiffViewer
          versions={versions}
          // 定提交对比模式：与 staged/工作区互斥（服务端 XOR 校验会给 400），故不传 onToggleStaged
          staged={false}
          language={languageForPath(path)}
          fromTo
          // 宿主是快照栏（窄栏）：并排两栏每侧只剩几十字符，故以「行内」开场——
          // 仅作**没存过偏好**时的初值，用户显式选过并排后按本机偏好开场
          initialSideBySide={false}
          loader={loader}
        />
      </div>
    );
  }
}
