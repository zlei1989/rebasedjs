/**
 * 长文本截断：长 hash / 长路径 / 长分支名的统一呈现。
 * 做什么：Typography.Text + ellipsis，支持等宽、语义色（type）、加粗语义（strong）与最大宽度，可选 hover 显示完整值。
 * 怎么做：用 antd 原生 ellipsis={{ tooltip }}（不自行包 Tooltip，少一层节点）；
 *        自身带 minWidth:0 —— flex 容器内截断生效的前提是父级链上都有 minWidth:0，
 *        父级由 PageShell / SplitPane 保证，本组件保证自身；
 *        `type` / `strong` 逐字转发给 antd，使「截断」与「次要色、危险色、加粗」不必二选一
 *        （原先把这类长文本转进来会丢语义样式，见 Task 12 报告「顾虑 1」，Ruling P17 / P17(c) 收口）。
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
  /**
   * 加粗语义（字重），原样转发给 `Typography.Text`。
   * 承载方式与 `type` 不同（antd 6.6.1 实测）：`type` 是根 `<span>` 上的 CSS 类（`ant-typography-secondary`），
   * `strong` 则是 antd 在根 `<span>` 内**再包一层 `<strong>`**，根类名逐字不变。
   * 类型取 antd 自己的 `TextProps['strong']`（不在此手写 `boolean`）：antd 改这个 prop 的形状时
   * 本组件自动跟随、不会漂移。加它的理由与 `type` 相同 —— 使「截断」与「原本就是加粗」不必二选一
   * （Ruling P17(c)：`tag-panel` 的标签名是 `strong`，不能为了可截断而丢掉字重）。
   */
  strong?: TextProps['strong'];
  /** 最大宽度；不传则由父级约束 */
  maxWidth?: number | string;
}

export function EllipsisText({ children, title, mono, type, strong, maxWidth }: EllipsisTextProps): ReactNode {
  const style: CSSProperties = { minWidth: 0 };
  if (maxWidth !== undefined) {
    style.maxWidth = maxWidth;
  }
  return (
    <Typography.Text
      code={mono}
      type={type}
      strong={strong}
      ellipsis={title !== undefined ? { tooltip: title } : true}
      style={style}
    >
      {children}
    </Typography.Text>
  );
}
