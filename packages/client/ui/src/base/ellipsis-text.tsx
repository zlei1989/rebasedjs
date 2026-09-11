/**
 * 长文本截断：长 hash / 长路径 / 长分支名的统一呈现。
 * 做什么：Typography.Text + ellipsis，支持等宽、语义色（type）与最大宽度，可选 hover 显示完整值。
 * 怎么做：用 antd 原生 ellipsis={{ tooltip }}（不自行包 Tooltip，少一层节点）；
 *        自身带 minWidth:0 —— flex 容器内截断生效的前提是父级链上都有 minWidth:0，
 *        父级由 PageShell / SplitPane 保证，本组件保证自身；
 *        `type` 逐字转发给 antd，使「截断」与「次要色/危险色」不必二选一
 *        （原先把次要色长文本转进来会丢 `type`，见 Task 12 报告「顾虑 1」，Ruling P17 收口）。
 */
import { Typography } from 'antd';
import type { TextProps } from 'antd/es/typography/Text';
import type { CSSProperties, ReactNode } from 'react';

export interface EllipsisTextProps {
  children: string;
  /**
   * 完整值；走 antd 原生 ellipsis tooltip。
   * 注意：**仅当文本真的溢出时** antd 才启用并渲染 tooltip —— 短文本传了 title 不会出现浮层
   * （antd 以布局溢出测量为准），空字符串还会被静默丢弃。故消费点（Task 11/12）不要
   * 依赖「传了 title 就一定有 hover 提示」。
   */
  title?: string;
  /** 等宽呈现（hash 用） */
  mono?: boolean;
  /**
   * 语义色，原样转发给 `Typography.Text`（antd 以 CSS 类表达，如 secondary → `ant-typography-secondary`，
   * 6.6.1 非内联样式）。
   * 类型取 antd 自己的 `TextProps['type']`（不在此手写联合类型）：antd 增删取值时本组件自动跟随、不会漂移。
   */
  type?: TextProps['type'];
  /** 最大宽度；不传则由父级约束 */
  maxWidth?: number | string;
}

export function EllipsisText({ children, title, mono, type, maxWidth }: EllipsisTextProps): ReactNode {
  const style: CSSProperties = { minWidth: 0 };
  if (maxWidth !== undefined) {
    style.maxWidth = maxWidth;
  }
  return (
    <Typography.Text
      code={mono}
      type={type}
      ellipsis={title !== undefined ? { tooltip: title } : true}
      style={style}
    >
      {children}
    </Typography.Text>
  );
}
