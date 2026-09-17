/**
 * 分栏布局：**antd `Splitter` 的配置映射**（原先自绘分隔条 + 手算宽度的实现已删除）。
 * 做什么：给日志页的就地快照区用——三栏「提交日志 | 提交详情 | 快照」各栏可拖，
 *        每条分隔条调整其左邻那一栏的宽度。
 * 现在这个文件只负责三件事，**真正干活的全在 antd 里**（拖拽、夹紧、键盘、双击、aria 语义）：
 *   ① 把 `ResizablePane` 映射成 `Splitter.Panel` 的 props（尺寸口径见下方注释，踩过两次坑）；
 *   ② 提供「分栏区 = Layout(Content(Splitter))」这层结构，让各栏拿到**确定高度**
 *      （没有它，栏内 `flex: 1` 会退化成 auto，内容栏被代码撑到 2343px——实测过）；
 *   ③ 每栏一个宿主节点，承接调用方的内边距与滚动。
 *
 * 尺寸口径（对着 antd `splitter/hooks/useSizes.js` 写，两处反直觉但必须遵守）：
 *   · 只要有**任何一个** Panel 带 `size`，Splitter 整体走 `propSizes` 分支，
 *     没给 `size` 的栏由 `autoPtgSizes` 补剩余空间 ⇒ **弹性列必须「不给 size」**才是吃剩余的那一栏
 *     （给它传期望值 900 会让它钉死在 900，日志栏实测被压成 0）；
 *   · Splitter 是**非受控**组件，`defaultSize` 只在挂载时读一次 ⇒ 想还原「上次拖出来的宽度」
 *     必须给 `size`（像素），用 `defaultSize` 的话刷新后会回到旧值（实测拖到 145、刷新回 173）。
 *
 * 为什么保留 `restoreWidthsToAvailable`：它是「落库的像素偏好 + 当前可用宽 → 本次渲染的像素值」
 * 这一步的纯函数。非弹性列的 `size` 是像素值，窗口变窄时若不按比例收，Splitter 只能硬夹到 min，
 * 栏间比例会跳变；交给它算，比例是稳定的，也便于单测。
 */
import { Layout, Splitter } from 'antd';
import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * 供布局计算使用的最小面板几何：只关心「当前宽 + 夹紧范围 + 是否弹性列」。
 * 单列出来是为了让 `restoreWidthsToAvailable` 不必要求完整的 `ResizablePane`
 * （那还得提供 label 与 content），调用方传几何数组即可。
 */
export interface PaneGeometry {
  width: number;
  min: number;
  max: number;
  /** 弹性列标记（至多一栏为 true）：吃富余空间，详见文件头的尺寸口径 */
  flexible?: boolean;
}

export interface ResizablePane extends PaneGeometry {
  /** React key 与无障碍名称（屏幕阅读器据此播报这是哪一栏） */
  key: string;
  label: string;
  content: ReactNode;
  /** 当前宽度（px，非弹性列会作为 Panel 的 `size` 传给 Splitter） */
  width: number;
  min: number;
  max: number;
  /**
   * 是否弹性列（用户口径：「提交日志」弹性宽度、自动收窄）：
   * 以「不给 `size`」交给 Splitter，于是它吃剩余空间；至多一栏为 true。
   */
  flexible?: boolean;
  /**
   * 该栏宿主的样式（与默认样式合并，同键覆盖）。
   * 默认样式是「撑满 + 纵向 flex + 裁剪」；调用方在这里给内边距与滚动
   * （如详情栏 `{ padding: 8, overflow: 'auto' }`、快照栏 `{ padding: 0 }`）。
   * 注意 `display`/`overflow` 会被调用方覆盖，故调用方要自己保证内容仍能撑满高度。
   */
  style?: CSSProperties;
}

export interface ResizableColumnsProps {
  panes: ResizablePane[];
  /** 拖动后各栏的**像素**宽度（下标与 panes 对齐），由调用方落库 */
  onWidthsChange: (widths: number[]) => void;
  /** 容器实测宽度上报（首帧 + 每次尺寸变化）；调用方据此把像素偏好还原到当前可用宽 */
  onAvailableChange?: (available: number) => void;
  /**
   * 指定栏的**实测像素宽度**上报（首帧 + 每次变化，含拖动过程中）。
   * 为什么需要它：Splitter 的拖动改的是它内部的尺寸状态，**不会**让调用方重渲染，
   * 故调用方无法从自己的 props 推出「这一栏现在多宽」。而「窄到某个阈值就隐去列」这类
   * 响应式行为必须跟着实测值走（否则拖动时不实时、只有松手后才跳一下）。
   */
  onPaneWidthChange?: (key: string, width: number) => void;
}

/** Splitter 的分隔条命中带宽度（px）：用于把可用宽换算成「扣除分隔条后的预算」 */
const HANDLE_HIT_WIDTH = 6;

/**
 * 按容器实测宽度**比例还原**非弹性列的像素宽度：够宽时原样返回；不够宽时按比例收（不低于 min）。
 * 弹性列不参与：它的宽度由 Splitter 的 `autoPtgSizes` 补剩余，期望值无意义（见文件头尺寸口径）。
 * 返回数组与入参同长同序（弹性列位置原样回填），便于调用方按下标取用。
 */
export function restoreWidthsToAvailable(widths: number[], panes: PaneGeometry[], available: number, handleCount: number): number[] {
  const budget = available - handleCount * HANDLE_HIT_WIDTH;
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (available <= 0 || total <= 0) return widths;
  // 够宽：原样（不必把富余塞给谁——Splitter 会把剩余留给没给 size 的弹性列）
  if (total <= budget) return widths;
  // 过窄：按比例收，再逐栏夹到 [min, max]；夹紧后仍可能超预算，故取夹紧结果（宁可略超，
  // 也不把任何一栏压到 min 以下——Splitter 自己还会再夹一次，这里是让比例先稳定下来）
  const scale = budget / total;
  return panes.map((pane, i) => Math.min(pane.max, Math.max(pane.min, widths[i] * scale)));
}

export function ResizableColumns({ panes, onWidthsChange, onAvailableChange, onPaneWidthChange }: ResizableColumnsProps): ReactNode {
  // 容器实测宽度：只为把 onAvailableChange 报给调用方（Splitter 自己也会量，这是我们那一份）
  const hostRef = useRef<HTMLDivElement | null>(null);
  const availableCbRef = useRef(onAvailableChange);
  availableCbRef.current = onAvailableChange;
  const paneWidthCbRef = useRef(onPaneWidthChange);
  paneWidthCbRef.current = onPaneWidthChange;
  // 各栏宿主节点的引用：用来观察**每栏实际宽度**（Splitter 拖动只改它自己的内部状态，
  // 不会让调用方重渲染，故实测是唯一能拿到「这一栏现在多宽」的途径）
  const paneNodesRef = useRef(new Map<string, HTMLDivElement>());
  const paneCallbackRef = useCallback(
    (key: string) => (node: HTMLDivElement | null) => {
      if (node === null) paneNodesRef.current.delete(key);
      else paneNodesRef.current.set(key, node);
    },
    [],
  );
  useLayoutEffect(() => {
    const node = hostRef.current;
    if (node === null) return;
    const report = (): void => availableCbRef.current?.(node.offsetWidth);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    /* 每栏宿主的宽度变化也一并观察：拖动时 Splitter 只改自己的内部状态，
       故这个观察器是「拖动过程中实时把栏宽报给调用方」的唯一来源（响应式隐列要靠它）。 */
    const panesObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement;
        const key = el.dataset.paneKey;
        if (key !== undefined) paneWidthCbRef.current?.(key, el.offsetWidth);
      }
    });
    for (const el of paneNodesRef.current.values()) panesObserver.observe(el);
    // 首帧也报一次（观察器只报变化，不报初值）
    for (const [key, el] of paneNodesRef.current) paneWidthCbRef.current?.(key, el.offsetWidth);
    return () => {
      observer.disconnect();
      panesObserver.disconnect();
    };
  }, [panes.length]);
  if (panes.length === 0) return null;
  return (
    /* 分栏区 = antd `Layout`：`Layout.Content` 本身就是「吃满父级剩余高度」的原语，
        为什么还留着 Layout 一层：它的「flex: auto + min-height: 0」就是「吃满剩余高度」的现成实现（自拼 flex 等于把它再写一遍），
       而 Content 一旦拿到确定高度，栏内那些 `flex: 1` 才有了可解析的参照——
       这正是此前内容栏被代码撑到 2343px 的根因（父级高度不确定时 `flex: 1` 退化成 auto）。
       外层 `minWidth: 0` 必须留着：它是日志页那个横向 Flex 的 flex item，
       默认 `min-width: auto` 会被内部内容撑宽（实测曾因此让整排溢出、盖住左边两栏）。 */
    <Layout style={{ flex: 1, minWidth: 0, minHeight: 0, background: 'transparent' }} ref={hostRef}>
      <Layout.Content style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Splitter onResize={onWidthsChange} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {panes.map((pane) => (
            <Splitter.Panel
              key={pane.key}
              // 弹性列：只给 min，**不给 size** ⇒ 由 Splitter 补剩余空间（见文件头尺寸口径）
              // 非弹性列：给 size（像素）⇒ 落库的偏好才能在刷新后真正还原
              {...(pane.flexible === true
                ? { min: pane.min }
                : { size: pane.width, min: pane.min, max: pane.max })}
            >
              {/* 栏宿主：**唯一**的一层节点（原先是「宿主 + 内容层」两层，内容层的约束直接落到这里，
                  于是每栏少一个 DOM 节点）。默认「撑满 + 纵向 flex + 裁剪」——
                  高度与滚动都靠这一层约束住，内容再长也不会把栏撑开；
                  调用方的 `style` 覆盖在其上（`display`/`overflow` 会被换掉，故调用方要自己保证仍能撑满）。 */}
              <div
                ref={paneCallbackRef(pane.key)}
                data-pane-key={pane.key}
                data-testid={`resizable-pane-${pane.key}`}
                style={{
                  height: '100%',
                  minWidth: 0,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  ...pane.style,
                }}
              >
                {pane.content}
              </div>
            </Splitter.Panel>
          ))}
        </Splitter>
      </Layout.Content>
    </Layout>
  );
}
