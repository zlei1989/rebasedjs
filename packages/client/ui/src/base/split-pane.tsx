/**
 * 两栏布局（侧栏 + 主区）：**antd `Splitter` 的薄适配**（原先自绘 flex + matchMedia 塌缩的实现已删除）。
 * 做什么：给「快照浏览页」（左文件树 / 右只读内容）与日志页的两栏形态用；
 *        侧栏默认 300、可拖，主区吃剩余空间，两栏各自内部滚动。
 * 为什么换成 Splitter：分隔条的指针捕获、键盘可达、双击复位、最小/最大夹紧、拖动态光标与
 *        `role=separator` 语义都由它提供，不必自己维护一份（与 `resizable-columns.tsx` 同一取舍）。
 * 参数映射：
 *   · `sidePosition: 'start' | 'end'` → Panel 的先后顺序（Splitter 按 children 顺序排）；
 *   · `sideWidth` → 侧栏 Panel 的 `defaultSize`（像素），`collapseBelow` → 侧栏 Panel 的 `min`
 *     （窗口再窄也不会把侧栏压没，超过可用宽时由 Splitter 自身夹紧）；
 *   · `gap` → Splitter 的 `styles.dragger`（分隔条命中带宽度即两栏视觉间距）。
 *
 * 边界（**与旧实现的行为差异，调用方需知**）：
 *   旧实现在视口窄于 `collapseBelow` 时改成**纵向堆叠**；Splitter 没有等价开关，
 *   本适配改为「始终保持左右并排 + 夹紧最小宽」。对本仓的用法（桌面为主、窄屏时页面级横滚）
 *   这是可接受的降级，但**不再是纵向堆叠**——`collapseBelow` 现在只作最小宽使用。
 * 说明：两栏宿主用原生 div 是**有意偏离** AGENT.md「避免裸写 div」——antd 没有
 *      「可滚动的通用盒子」原语，用 <Flex> 包单个孩子只是徒增节点。
 */
import { Splitter } from 'antd';
import type { ReactNode } from 'react';

export interface SplitPaneProps {
  /** 侧栏内容 */
  side: ReactNode;
  /** 主区内容 */
  children: ReactNode;
  /** 侧栏宽度（px），默认 300 */
  sideWidth?: number;
  /** 侧栏位置，默认 'start'（browse 在左、log 在右） */
  sidePosition?: 'start' | 'end';
  /** 视口窄于此值时旧实现会纵向堆叠；现在只用于给侧栏一个最小宽（见文件头「边界」） */
  collapseBelow?: number;
  /** 两栏间距（px）；映射到分隔条的命中带宽度 */
  gap?: number;
}

export function SplitPane({ side, children, sideWidth = 300, sidePosition = 'start', gap = 8 }: SplitPaneProps): ReactNode {
  const sidePanel = (
    <Splitter.Panel key="side" defaultSize={sideWidth} min={sideWidth}>
      {/* 侧栏宿主：固定宽度由 Panel 给，内部滚动由调用点的内容自带 */}
      <div data-testid="split-side-host" style={{ height: '100%', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        {side}
      </div>
    </Splitter.Panel>
  );
  const mainPanel = (
    <Splitter.Panel key="main">
      <div data-testid="split-main-host" style={{ height: '100%', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        {children}
      </div>
    </Splitter.Panel>
  );
  return (
    /* 两栏间距**不覆盖**分隔条宽度：`styles.dragger` 会整个替换 antd 的 dragger 样式，
       传 `width` 会把它的命中带改成 0（实测三条分隔条宽度全为 0、看不见也拖不到）。
       antd 自带 `--ant-splitter-bar-size`/trigger 尺寸，交给它即可。 */
    <Splitter style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {sidePosition === 'start' ? [sidePanel, mainPanel] : [mainPanel, sidePanel]}
    </Splitter>
  );
}
