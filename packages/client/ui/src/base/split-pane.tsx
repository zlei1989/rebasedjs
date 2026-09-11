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
    // 纵向堆叠：两者都占满宽度，横向溢出归零；各自保留内部滚动
    const stackedSide: CSSProperties = { width: '100%', flexShrink: 0, overflow: 'auto' };
    const stackedMain: CSSProperties = { width: '100%', flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' };
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
