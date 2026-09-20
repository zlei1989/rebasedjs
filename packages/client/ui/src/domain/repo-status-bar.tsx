/**
 * 仓库状态条：分支名 + ahead/behind 圆点徽标（圆点后追加箭头计数）。
 * UX 对齐 #5（Java GitInOutState 2025 版形态）：彩色圆点徽标（incoming 蓝 / outgoing 绿）+ 计数。
 * 计数从「只在 tooltip 里」抬到明面：圆点后跟 ↓数字 / ↑数字，方向取 git 惯例
 * （**↑ = 本地领先 = ahead/outgoing**，**↓ = 远端领先 = behind/incoming**），颜色随各自圆点；
 * 某一侧为 0 则该侧整体不渲染（含圆点与数字），两侧全 0 连外框都不渲染——沿用原「不显示」口径。
 * tooltip 保留（文案不变），数字另带 aria-label 读屏口径，箭头对读屏隐藏。
 * 分支 chip 可点复制（点一下把分支名写进剪贴板，便于粘进命令或 PR）——走 base/CopyOnClick；
 * 游离 HEAD 时 chip 文案是 `(detached HEAD)`，那是展示占位而非真实 ref 名，故**不做成复制目标**。
 * chip 单行省略 + `maxWidth`（全名挂 title 悬停可看）：状态条挂在顶栏**右侧操作区最左**，那一侧不收缩，
 * 长分支名若放任撑开，被挤掉的是左侧面包屑；这里限宽后省略号才有的可截。
 */
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Badge, Flex, Tag, Tooltip, theme } from 'antd';
import type { RepoStatus } from '@rebased/contracts';
import { CopyOnClick } from '../base/copy-on-click';

export interface RepoStatusBarProps {
  status: RepoStatus;
}

type InoutSide = 'incoming' | 'outgoing';

/** 两侧的展示口径：方向、圆点色（antd Badge 预设色）与读屏文案 */
const SIDE = {
  incoming: {
    color: 'blue',
    /** antd Badge 预设色 blue 的实际取值：箭头/数字与之同色，避免「哪个数字配哪个圆点」靠猜 */
    hex: '#1677ff',
    arrow: <ArrowDownOutlined aria-hidden />,
    label: (n: number) => `远端领先 ${n} 个提交（incoming，尚未拉到本地）`,
  },
  outgoing: {
    color: 'green',
    hex: '#52c41a',
    arrow: <ArrowUpOutlined aria-hidden />,
    label: (n: number) => `本地领先 ${n} 个提交（outgoing，尚未推到远端）`,
  },
} as const;

/** 单侧「圆点 + 箭头 + 数字」：圆点带 data-testid，数字带 aria-label（读屏读到的是完整口径而非裸数字）。
 *  数字用裸 span 而非 antd Typography.Text：antd 6 顶层没有 Text 导出，
 *  且这里只要「小号 + 跟随圆点色」，Typography 自带的 margin/标题语义都是多余负担。 */
function SyncCount({ side, count }: { side: InoutSide; count: number }): React.ReactNode {
  const { color, hex, arrow, label } = SIDE[side];
  const { token } = theme.useToken();
  const textStyle: React.CSSProperties = { color: hex, fontSize: token.fontSizeSM, lineHeight: 1 };
  return (
    <Flex data-testid={side} align="center" gap={2}>
      {/* 圆点仍走 antd Badge 语义色（色类落在内层圆点上，尺寸由组件给） */}
      <Badge color={color} />
      {/* aria-hidden 挂在外层：@ant-design/icons 自身已带 aria-hidden，但外层再兜一层，
          防止将来换成自定义节点时把装饰箭头暴露给读屏 */}
      <span aria-hidden style={{ display: 'inline-flex', ...textStyle }}>
        {arrow}
      </span>
      {/* aria-label 盖住裸数字，箭头/圆点均不进读屏：这一格读出来是「本地领先 5 个提交（outgoing…）」 */}
      <span aria-label={label(count)} style={textStyle}>
        {count}
      </span>
    </Flex>
  );
}

export function RepoStatusBar({ status }: RepoStatusBarProps): React.ReactNode {
  const { branch, ahead, behind } = status;
  const chip = (
    /* 分支名用小 Tag 承载（chip 形态，对齐提交图里的 ref chips）。
        注意：antd 6.6.3 的 Tag **没有** size 变体（TagProps 无 size，样式里也无 -sm/-lg 分支），
        它本身即「小」尺寸——高度由 token fontSizeSM（紧凑密度下 12px）决定，故不传 size、不额外压字号。
        限宽 240 + 单行省略：顶栏右区不收缩，长分支名不让步就会把左侧面包屑挤没；
        `title` 给原生悬停全名（点一下复制同样能拿到全名）。 */
    <Tag
      data-testid="status-branch-chip"
      title={branch ?? undefined}
      style={{
        marginInlineEnd: 0,
        maxWidth: 240,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {branch ?? '(detached HEAD)'}
    </Tag>
  );
  return (
    <Flex align="center" gap={8}>
      {/* 分支名为空（游离 HEAD）时不给复制目标：复制的是一句展示占位，粘出去没有意义 */}
      {branch === null ? (
        chip
      ) : (
        <CopyOnClick text={branch} plain>
          {chip}
        </CopyOnClick>
      )}
      {ahead > 0 || behind > 0 ? (
        <Tooltip title={`${behind} incoming and ${ahead} outgoing commits`}>
          {/* 侧内 gap 2（圆点-箭头-数字贴成一组）、侧间 gap 8：两组之间留白明显大于组内，避免看成四个并列元素 */}
          <Flex data-testid="inout-badges" align="center" gap={8}>
            {behind > 0 ? <SyncCount side="incoming" count={behind} /> : null}
            {ahead > 0 ? <SyncCount side="outgoing" count={ahead} /> : null}
          </Flex>
        </Tooltip>
      ) : null}
    </Flex>
  );
}
