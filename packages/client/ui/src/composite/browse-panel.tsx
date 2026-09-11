/**
 * 历史快照浏览面板：左文件树（目录聚合 + 子模块/符号链接徽标）+ 右只读内容视图。
 * 对应 Java RepositoryBrowser 的 Web 形态——以某提交为根浏览（虚拟文件语义，不触碰工作区）。
 * 纯受控（entries/content/回调由容器注入）；ui 不调接口。
 * 降级边界：子模块（type=commit）不可选中；二进制（binary=true）仅提示不渲染；
 * 空版本、加载/错误态均有占位。
 */
import { Card, Flex, Spin, Tag, Tooltip, Typography } from 'antd';
import type { BrowseContent, BrowseEntry } from '@rebased/contracts';
import { useMemo } from 'react';
import { EllipsisText } from '../base/ellipsis-text';
import { EmptyState } from '../base/empty-state';
import { FileTree, FILE_TREE_TOOLTIP, type FileTreeNode } from '../base/file-tree';
import { SplitPane } from '../base/split-pane';
import { buildDirectoryTree } from '../domain/directory-tree';

export interface BrowsePanelProps {
  /** 浏览目标版本（回显 + key 语义由容器持有） */
  rev: string;
  entries?: BrowseEntry[];
  loading?: boolean;
  error?: string;
  /** 当前选中文件路径（受控；目录不进入选中态） */
  selectedPath?: string;
  content?: BrowseContent;
  contentLoading?: boolean;
  contentError?: string;
  onSelectFile?: (path: string) => void;
}

/** 条目形态徽标：子模块（gitlink）与符号链接仅作标注，不参与内容预览 */
function entryBadge(entry: BrowseEntry): React.ReactNode {
  if (entry.type === 'commit') return <Tag color="default">子模块</Tag>;
  if (entry.mode === '120000') return <Tag color="default">链接</Tag>;
  return null;
}

export function BrowsePanel({
  rev,
  entries,
  loading,
  error,
  selectedPath,
  content,
  contentLoading,
  contentError,
  onSelectFile,
}: BrowsePanelProps): React.ReactNode {
  // 平铺条目 → 目录树；目录聚合共用 buildDirectoryTree（与 CommittedChangesPanel 目录树同源）；
  // 叶子按条目形态覆写 selectable/标题徽标（子模块不可选中，blob 可选中）
  const nodes = useMemo<FileTreeNode[]>(() => {
    const tree = buildDirectoryTree((entries ?? []).map((e) => e.path));
    const byPath = new Map((entries ?? []).map((e) => [e.path, e]));
    const enrich = (list: FileTreeNode[]): FileTreeNode[] =>
      list.map((node) => {
        if (node.isLeaf && node.key !== undefined) {
          const entry = byPath.get(node.key);
          if (entry === undefined) return node;
          return {
            ...node,
            selectable: entry.type === 'blob',
            title: (
              <span>
                {node.title}
                {entryBadge(entry)}
              </span>
            ),
          };
        }
        return node.children !== undefined ? { ...node, children: enrich(node.children) } : node;
      });
    return enrich(tree);
  }, [entries]);
  // 初始展开：仅第一层目录（大仓库不整树展开；rev 变化由容器 key 重挂载刷新初始态）
  const topDirs = useMemo(
    () => nodes.filter((n) => n.children !== undefined && n.children.length > 0).map((n) => n.key),
    [nodes],
  );
  return (
    <Flex vertical gap={8} style={{ padding: 16, height: '100%' }}>
      <Typography.Text code data-testid="browse-rev">
        {rev}
      </Typography.Text>
      {loading ? (
        <Spin data-testid="browse-loading" />
      ) : error ? (
        <Typography.Text type="danger" data-testid="browse-error">
          {error}
        </Typography.Text>
      ) : !entries || entries.length === 0 ? (
        <EmptyState title="该版本没有文件" />
      ) : (
        /* 两栏改 SplitPane：侧栏在左（sidePosition 默认 'start'）、宽 300、栏间距 12（gap）。
           写死宽度 + flexShrink:0 的侧栏正是窄屏横向溢出的结构性成因，改由原语在过窄视口堆叠；
           原主区 Card 的 flex:1/minWidth:0 与侧栏 Card 的 width:300/flexShrink:0 由 SplitPane 两个宿主承担，故不再重复声明。
           两张 Card 仍各带 height:'100%' + overflow:'auto' —— 这是**复刻迁移前的视觉**，不是可删的冗余：
           迁移前两卡是行容器的 flex 子项，被默认 align-items:stretch 拉伸到整栏高，Card 自身的 overflow:'auto'
           在 Card 上滚动其内容（= 卡撑满整栏、内容在卡内滚）。改成宿主 div 的普通子元素后，它们退回内容高
           （栏看着没撑满），且滚动落到宿主上，整张卡连同标题（如「文件（N）」）一起滚走 —— 对文件树是真实退化。
           height:'100%' 等价还原「被 stretch 拉伸」（宿主是撑满的 flex 子项、高度确定，百分比高度可解析），
           overflow:'auto' 把滚动还到 Card 自己身上；宿主的 overflow:'auto' 随之惰性（卡恰为 100% 高，永不溢出
           宿主），无害，故不改 SplitPane 原语。 */
        <SplitPane
          sideWidth={300}
          gap={12}
          side={
            <Card
              size="small"
              title={`文件（${entries.length}）`}
              style={{ height: '100%', overflow: 'auto' }}
            >
              {/* FileTree 是复合组件（不转发 ref / 不落 DOM 事件），Tooltip 需要真实节点承载 hover，
                  故在中间包一层 block span 作为悬停宿主（布局等同原 div，尺寸不变）。 */}
              <Tooltip title={FILE_TREE_TOOLTIP}>
                <span style={{ display: 'block' }}>
                  <FileTree
                    nodes={nodes}
                    selectedKeys={selectedPath !== undefined ? [selectedPath] : []}
                    onSelect={onSelectFile}
                    defaultExpandedKeys={topDirs}
                  />
                </span>
              </Tooltip>
            </Card>
          }
        >
          <Card
            size="small"
            style={{ height: '100%', overflow: 'auto' }}
            title={
              selectedPath !== undefined ? (
                /* 长路径改 EllipsisText：Card 标题横向被长路径撑宽曾是主区溢出来源之一；
                   其自带 minWidth:0，antd 的 .ant-card-head-title 本身 overflow:hidden（自动最小尺寸为 0），
                   故 flex 链上从 Card 起即可收缩，无需再给标题容器补样式。 */
                <EllipsisText mono title={selectedPath}>
                  {selectedPath}
                </EllipsisText>
              ) : (
                '内容'
              )
            }
          >
            {selectedPath === undefined ? (
              <EmptyState title="在左侧选择文件查看内容" />
            ) : contentLoading ? (
              <Spin data-testid="browse-content-loading" />
            ) : contentError !== undefined ? (
              <Typography.Text type="danger" data-testid="browse-content-error">
                {contentError}
              </Typography.Text>
            ) : content === undefined ? null : content.binary ? (
              <Typography.Text type="warning" data-testid="browse-binary">
                二进制文件，不支持文本预览
              </Typography.Text>
            ) : (
              <pre
                data-testid="browse-content"
                style={{
                  margin: 0,
                  fontFamily: 'Menlo, Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.7,
                  whiteSpace: 'pre',
                }}
              >
                {content.content}
              </pre>
            )}
          </Card>
        </SplitPane>
      )}
    </Flex>
  );
}
