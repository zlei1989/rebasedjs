/**
 * 受影响文件弹窗（Show All Affected #34）：某次提交改动的全部文件清单。
 * 从 composite/blame-view 搬出：溯源页改成三栏后触发点在右栏操作条（blame-change-pane），
 * 与注解行表不再是同一个组件的事。行为与文案逐字未改（纯受控：hash 非空即开，
 * 数据由容器经 useCommitFiles 条件拉取；行点击由容器接「该文件在这次提交里的差异」）。
 */
import { Flex, Listy, Modal, Spin, Typography } from 'antd';
import type { CommittedEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { CommittedStatusTag } from '../domain/committed-status';
import { formatCommitDate } from '../domain/format';

export interface AffectedFilesModalProps {
  /** 受控打开键（'' = 关闭）；非空时标题显示该提交短哈希 */
  hash: string;
  entry?: CommittedEntry | null;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
  /** 清单里点文件（path——容器接 diff：from=父哈希、to=该提交）；缺省行只读 */
  onOpenFile?: (path: string) => void;
}

/** 受影响文件行：状态徽标 + （重命名时原名 →）+ 路径；点击 → onOpenFile(path)（缺省只读） */
function AffectedFileRow({
  file,
  index,
  onOpenFile,
}: {
  file: CommittedEntry['files'][number];
  index: number;
  onOpenFile?: (path: string) => void;
}): React.ReactNode {
  return (
    /* 整行可点（未注入 onOpenFile 时为只读行）：行内边距已移除，改用 Listy 行容器的 antd 默认；
       代价是那圈内边距落在包装 div 上、不属本元素命中区
       （Listy 无 onItemClick，无法两全；已由用户裁定接受）。下边框/悬停底色交给 Listy 行容器。
       行**不挂 Tooltip**（本次产品口径：行不挂气泡，行内按钮/图标的气泡保留） */
    <Flex
      data-testid={`affected-file-${index}`}
      align="center"
      gap={8}
      style={{ cursor: onOpenFile ? 'pointer' : undefined }}
      onClick={() => onOpenFile?.(file.path)}
    >
      <CommittedStatusTag status={file.status} />
      {file.renameFrom ? (
        <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
          {file.renameFrom} →
        </Typography.Text>
      ) : null}
      <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
        {file.path}
      </Typography.Text>
    </Flex>
  );
}

/** 受影响文件 Modal（Show All Affected #34）：提交元信息头 + 全量文件清单（antd Listy）；loading/error/空态分派 */
export function AffectedFilesModal({
  hash,
  entry,
  loading,
  error,
  onClose,
  onOpenFile,
}: AffectedFilesModalProps): React.ReactNode {
  return (
    <Modal
      title={`受影响文件（${entry?.shortHash ?? hash.slice(0, 7)}）`}
      open={hash !== ''}
      footer={null}
      width={720}
      onCancel={onClose}
    >
      {loading ? (
        <Spin data-testid="affected-loading" />
      ) : error ? (
        <Typography.Text type="danger" data-testid="affected-error">
          {error}
        </Typography.Text>
      ) : entry === null || entry === undefined || entry.files.length === 0 ? (
        entry !== null && entry !== undefined && entry.parents.length > 1 ? (
          /* 合并提交：git log--name-status 默认不展开 merge 变更（与 CommittedChangesPanel 同语义提示） */
          <EmptyState title="合并提交" description="git 对合并提交默认不列出文件变更；请到日志页查看合并结果" />
        ) : (
          <EmptyState title="该提交无文件变更" />
        )
      ) : (
        <Flex vertical>
          <Typography.Text type="secondary">
            {entry.subject} · {entry.author} · {formatCommitDate(entry.dateIso)}
          </Typography.Text>
          {/* 文件清单走 antd Listy（6.6.0 起的列表组件）：行容器/下边框/悬停底色由组件负责，
              调用方只给数据与行内容。行内边距走 antd 默认（不再手调）。 */}
          <Listy
            items={entry.files}
            // 提交内文件路径唯一（git name-status 逐路径一条），故以 path 作行键
            rowKey={(file) => file.path}
            itemRender={(file, index) => <AffectedFileRow file={file} index={index} onOpenFile={onOpenFile} />}
          />
        </Flex>
      )}
    </Modal>
  );
}
