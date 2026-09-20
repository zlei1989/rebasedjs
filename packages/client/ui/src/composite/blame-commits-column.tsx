/**
 * 中栏「提交记录」列：该文件的提交清单（git log --follow，跟随重命名，最新在上）。
 * 行 = 短哈希 + 标题 + 作者 + 日期；**单击整行 = 选中该提交**（右栏三标签随之换版本）。
 * 行内不放按钮：日志页定位 / 新标签页差异 / 受影响 / 文件历史四个出口统一收在右栏操作条，
 * 免得一栏里每行挤四个按钮（用户口径，见 design §1.3 / D4）。
 * 列表走 antd Listy（与文件历史页同口径）；不做虚拟滚动——与既有 /history 页一致，行为不倒退。
 * 不做上下键在行间移动（design §0.3 明列的非目标），Tab 逐行停靠 + Enter/Space 激活即够。
 * 纯受控：不调接口，数据与回调由容器注入。
 */
import { Flex, Listy, Spin, theme, Typography } from 'antd';
import type { FileHistoryEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface BlameCommitsColumnProps {
  entries?: FileHistoryEntry[];
  loading?: boolean;
  error?: string;
  /** 当前选中的提交（陈旧深链不在清单里时不会有任何行高亮——不猜、不改写用户链接） */
  selectedHash?: string | null;
  /** 点行 → 选中该提交；缺省行只读 */
  onSelect?: (hash: string) => void;
}

export function BlameCommitsColumn({
  entries,
  loading,
  error,
  selectedHash,
  onSelect,
}: BlameCommitsColumnProps): React.ReactNode {
  // 分隔与选中底色走主题 token（暗色主题下硬编码浅色会过亮）
  const { token } = theme.useToken();
  if (loading === true) return <Spin data-testid="blame-commits-loading" />;
  if (error !== undefined) {
    return (
      <Typography.Text type="danger" data-testid="blame-commits-error">
        {error}
      </Typography.Text>
    );
  }
  if (entries === undefined || entries.length === 0) return <EmptyState title="该文件暂无提交记录" />;
  return (
    <div data-testid="blame-commits">
      <Listy
        items={entries}
        rowKey={(entry) => entry.hash}
        itemRender={(entry, index) => {
          const selected = selectedHash !== undefined && selectedHash !== null && selectedHash === entry.hash;
          const clickable = onSelect !== undefined;
          // 鼠标点击与键盘激活共用同一个入口：两路各写一份判据，迟早漂移出「键盘也能选到只读行」这类不一致
          const activate = clickable ? () => onSelect(entry.hash) : undefined;
          // 行是本页主导航的唯一入口，而只挂 onClick 的 div 键盘够不到（已核 antd 6.6.3 / @rc-component/listy 1.2.3：
          // 列表行容器不带 tabIndex/键盘处理）——故可点行给 role="button" + tabIndex 0 + Enter/Space，
          // 与注解行表同口径（design §1.4 对注解行的同款要求，progress Ruling 已裁「成立，修」）。
          // 只读行（未注入 onSelect）不给 role/tabIndex：免得 Tab 停在一个按了也没反应的死控件上
          const onKeyDown =
            activate === undefined
              ? undefined
              : (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                // Space 的默认行为是滚动清单（行在视口内会被顶走）：拦掉，只留激活
                if (event.key === ' ') event.preventDefault();
                activate();
              };
          return (
            <Flex
              data-testid={`blame-commit-${index}`}
              data-selected={selected ? 'true' : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              vertical
              gap={2}
              style={{
                ...(clickable ? { cursor: 'pointer' } : {}),
                ...(selected ? { background: token.controlItemBgActive, borderRadius: token.borderRadius } : {}),
              }}
              onClick={activate}
              onKeyDown={onKeyDown}
            >
              <Flex align="center" gap={8}>
                <Typography.Text code style={{ flexShrink: 0 }}>
                  {entry.shortHash}
                </Typography.Text>
                <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
                  {entry.subject}
                </Typography.Text>
              </Flex>
              <Flex align="center" gap={8}>
                <Typography.Text type="secondary" style={{ flex: 1, minWidth: 0 }} ellipsis>
                  {entry.author}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
                  {formatCommitDate(entry.dateIso)}
                </Typography.Text>
              </Flex>
            </Flex>
          );
        }}
        styles={{ item: { borderRadius: token.borderRadius } }}
      />
    </div>
  );
}
