/**
 * name-status 状态码 → 徽标共享件：CommittedChangesPanel（提交变更文件列表）与
 * BlameView 受影响文件 Modal（Show All Affected #34）同源渲染。
 */
import { Tag } from 'antd';
import type { CommittedFileStatus } from '@rebased/contracts';

/** A 新增绿 / M 修改蓝 / D 删除红 / R 重命名紫 / C 复制青 / T 类型变更橙 */
export const COMMITTED_STATUS_COLORS: Record<CommittedFileStatus, string> = {
  A: 'green',
  M: 'blue',
  D: 'red',
  R: 'purple',
  C: 'cyan',
  T: 'orange',
};

/** 状态徽标：A/M/D/R/C/T 配色 Tag（marginInlineEnd 由调用方布局约定） */
export function CommittedStatusTag({ status }: { status: CommittedFileStatus }): React.ReactNode {
  return (
    <Tag color={COMMITTED_STATUS_COLORS[status]} style={{ flexShrink: 0, marginInlineEnd: 8 }}>
      {status}
    </Tag>
  );
}
