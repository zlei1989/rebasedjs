/**
 * 主区 + 侧栏两栏布局：视口过窄时自动改为纵向堆叠。
 * 做什么：取代写死 width + flexShrink:0 的侧栏（browse-panel 300 / log-page 320），
 *        消除窄屏必然横向溢出的结构性成因。
 * 怎么做：宽屏为一行 flex（侧栏固定宽、主区 flex:1 + minWidth:0 可收缩、两侧各自内部滚动）；
 *        命中 (max-width: collapseBelow-1px) 时改为纵向，两者各占 width:100%，横向溢出归零、内部滚动保留。
 * 注意：SSR/无 matchMedia 时回退「不折叠」，避免首帧误判。
 *
 * 边界：本组件**只做布局** —— 不引入 ConfigProvider、不碰密度（一个路由只有一个 PageShell 拥有密度），
 *      也不画分隔线（log 页侧栏的 borderLeft 属于侧栏自身元素，留在调用点）。
 * 说明：两栏宿主用原生 div 是**有意偏离** AGENT.md「避免裸写 div」—— antd 没有「可滚动的通用盒子」
 *      原语，用 <Flex> 包单个孩子只是徒增节点；外层容器仍用 antd Flex。
 */
import { Flex } from 'antd';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/** 视口是否窄于 maxWidth（受控于 matchMedia，SSR/无 matchMedia 时 false） */
function useViewportBelow(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth - 1}px)`;
  const [below, setBelow] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    setBelow(mql.matches);
    const onChange = (event: MediaQueryListEvent): void => setBelow(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return below;
}

export interface SplitPaneProps {
  /** 侧栏内容 */
  side: ReactNode;
  /** 主区内容 */
  children: ReactNode;
  /** 侧栏宽度（px），默认 300 */
  sideWidth?: number;
  /** 侧栏位置，默认 'start'（browse 在左、log 在右） */
  sidePosition?: 'start' | 'end';
  /** 视口窄于此值时改为纵向堆叠，默认 768 */
  collapseBelow?: number;
}

export function SplitPane({
  side,
  children,
  sideWidth = 300,
  sidePosition = 'start',
  collapseBelow = 768,
}: SplitPaneProps): ReactNode {
  const collapsed = useViewportBelow(collapseBelow);

  if (collapsed) {
    // 纵向堆叠：两者都占满宽度（横向溢出归零），并**等分可用高度、各自内部滚动**。
    // 为什么不是「侧栏 flexShrink:0 + 主区 flex:1」：在 column 容器里那套几何是致命的 ——
    //   侧栏无高度预算（无 height/maxHeight/minHeight:0）会保持内容全高 Hs，负自由空间 H-Hs
    //   按收缩因子分摊，而主区 basis 为 0% 提供不了任何收缩量，最终解析为**高度 0**；
    //   侧栏自身 overflow:auto 也永不生效（盒子高度 == 内容高度，只会纵向溢出而非滚动）。
    //   即把横向那套「写死宽度 + flexShrink:0」错抄进了纵轴，而它在纵轴上不成立。
    // 所以两栏一律 flex: '1 1 0%' + minHeight: 0：basis 0 的等分 + 允许收缩，
    //   保证**任何一栏都不会被压成 0 高**，且两栏都能内部滚动 —— 这正是宽屏分支用 minWidth:0
    //   避免的同一个错误在纵轴上的修法。width: '100%' 保留，两者仍横向撑满。
    // 写法说明：写 `0%` 而非无单位 `0`。二者在本组件要求的**确定高度**容器里解析完全相同
    //   （0% 对容器高度求百分比 = 0），但 jsdom 的 cssstyle 会整条丢弃 `flex: 1 1 0`
    //   （实测 style 属性为 null），使该几何在测试里彻底不可见；`1 1 0%` 被完整保留
    //   （flexGrow=1 / flexShrink=1 / flexBasis=0%），断言才真正具有判别力。
    //   附带好处：容器高度万一不确定时，0% 退化为 auto（按内容高），比无单位 0 更稳。
    const stackedSide: CSSProperties = {
      width: '100%',
      flex: '1 1 0%',
      minWidth: 0,
      minHeight: 0,
      overflow: 'auto',
    };
    const stackedMain: CSSProperties = {
      width: '100%',
      flex: '1 1 0%',
      minWidth: 0,
      minHeight: 0,
      overflow: 'auto',
    };
    return (
      <Flex vertical style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <div style={stackedSide} data-testid="split-side-host">
          {side}
        </div>
        <div style={stackedMain} data-testid="split-main-host">
          {children}
        </div>
      </Flex>
    );
  }

  const sideStyle: CSSProperties = { width: sideWidth, flexShrink: 0, overflow: 'auto' };
  const mainStyle: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' };
  return (
    <Flex style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      {sidePosition === 'start' ? (
        <>
          <div style={sideStyle} data-testid="split-side-host">
            {side}
          </div>
          <div style={mainStyle} data-testid="split-main-host">
            {children}
          </div>
        </>
      ) : (
        <>
          <div style={mainStyle} data-testid="split-main-host">
            {children}
          </div>
          <div style={sideStyle} data-testid="split-side-host">
            {side}
          </div>
        </>
      )}
    </Flex>
  );
}
