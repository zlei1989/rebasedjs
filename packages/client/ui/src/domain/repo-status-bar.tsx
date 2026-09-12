/**
 * 仓库状态条：分支名 + ahead/behind 圆点徽标。
 * UX 对齐 #5（Java GitInOutState 2025 版形态）：彩色圆点徽标（incoming 蓝 / outgoing 绿）
 * + tooltip 计数，两者为 0 不显示徽标——不做旧版 ↑↓ 数字文本。
 */
import { Tag, Tooltip } from 'antd';
import type { RepoStatus } from '@rebased/contracts';

export interface RepoStatusBarProps {
  status: RepoStatus;
}

/** incoming（待拉取 = behind）圆点色 */
const INCOMING_COLOR = '#389FD6';
/** outgoing（待推送 = ahead）圆点色 */
const OUTGOING_COLOR = '#59A869';

const dotStyle = (backgroundColor: string): React.CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor,
});

export function RepoStatusBar({ status }: RepoStatusBarProps): React.ReactNode {
  const { branch, ahead, behind } = status;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
      {/* 分支名用小 Tag 承载（chip 形态，对齐提交图里的 ref chips）。
          注意：antd 6.6.3 的 Tag **没有** size 变体（TagProps 无 size，样式里也无 -sm/-lg 分支），
          它本身即「小」尺寸——高度由 token fontSizeSM（紧凑密度下 12px）决定，故不传 size、不额外压字号。 */}
      <Tag>{branch ?? '(detached HEAD)'}</Tag>
      {ahead > 0 || behind > 0 ? (
        <Tooltip title={`${behind} incoming and ${ahead} outgoing commits`}>
          <span data-testid="inout-badges" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            {behind > 0 ? <span data-testid="incoming" style={dotStyle(INCOMING_COLOR)} /> : null}
            {ahead > 0 ? <span data-testid="outgoing" style={dotStyle(OUTGOING_COLOR)} /> : null}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
