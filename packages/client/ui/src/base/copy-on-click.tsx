/**
 * 点文字即复制：把任意一段展示文本变成「点一下拷贝到剪贴板」的可点目标。
 * 做什么：渲染一个真实 `<button>`（天然可聚焦、Enter/空格可触发，不必自造键盘处理），
 *        内容就是原文；**先按原样高亮文本**，点击时把 `text`（与展示文本解耦，例如显示短 hash、复制完整 hash）
 *        写入剪贴板，并在悬停/聚焦时于右侧浮出一枚复制图标 + 气泡说明。
 * 怎么做：复制动作走 base/clipboard 的 `copyToClipboard`（异步写 + execCommand 兜底），
 *        只在写成功后回一个短暂的「已复制」态（图标换成对勾、气泡换成已复制文案）；
 *        写失败（浏览器拒绝剪贴板权限）不谎报成功——图标与气泡都保持原文案，调用方无需感知。
 * 为什么不是 antd `Typography.Text copyable`：那一个把**复制图标**做成动作、文本本身不可点，
 *        且图标恒占位；本场景要的是「点文本」，且 chip / 哈希 / 作者行 / 多行正文都要用同一种交互。
 * 为什么不用 message 弹提示：详情面板里连点几个 chip 会连出一串全局提示，气泡就近反馈更克制，
 *        也不必给 ui 包引入 App 上下文依赖（本包是纯展示层，静态 message 会脱离 App 主题）。
 * 视觉：悬停/聚焦时叠一层 `controlItemBgHover`、复制瞬间叠 `controlItemBgActive`（两个都是主题 token，
 *        亮暗主题各自成立），并给一条 `borderBottom` 虚线提示「这里可以点」；
 *        所有颜色都写成透明/变换而非条件渲染，避免鼠标进出引起重排。
 * 注意：`display: inline-block` 是刻意的——inline 元素吃不到 padding 与背景铺排，
 *        而 `maxWidth: '100%'` 必须给，否则多行正文会把宿主面板撑宽。
 * plain 模式：给排版已定型的位置（作者名 / 日期行等塞不下按钮底色与虚线）——渲染一根不带任何样式的
 *        `<span>`（唯一样式 `cursor: copy`，无键盘可达性，换鼠标交互的轻量位置用），点击仍复制；
 *        气泡 open 完全受控于「已复制」态：**不点击永远不出现**（悬停也不出），
 *        点击且写剪贴板成功后才弹一枚「已复制」，失败不弹（不谎报成功，口径与非 plain 一致）。
 */
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { Tooltip, theme } from 'antd';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { copyToClipboard } from './clipboard';

export interface CopyOnClickProps {
  /** 写入剪贴板的内容（与 children 展示的文本解耦） */
  text: string;
  /** 悬停提示，点明「点一下会复制什么」（plain 模式不悬停出气泡，可不传） */
  hint?: string;
  children: ReactNode;
  /** 等宽呈现（hash / 引用名 / 正文用）；plain 模式忽略——plain 不改任何字体样式 */
  mono?: boolean;
  /** 纯文本模式：只有 <span> 内容与 cursor: copy，无任何样式；点击且复制成功后才弹「已复制」气泡，不点击无任何提示 */
  plain?: boolean;
  'data-testid'?: string;
}

/** 「已复制」态保持时长：够看清图标变化与气泡，又不至于让下一次点击看起来没反应 */
const COPIED_FLASH_MS = 1200;

export function CopyOnClick({ text, hint, children, mono, plain, 'data-testid': testId }: CopyOnClickProps): ReactNode {
  const { token } = theme.useToken();
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);
  // 定时器句柄：连续点击要重置同一次闪烁，卸载时清掉（避免卸载后 setState）
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);
  const onClick = (): void => {
    void copyToClipboard(text).then((ok: boolean) => {
      // 只在真的写成功时给「已复制」：失败（权限被拒）谎报成功比不提示更糟
      if (!ok) return;
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    });
  };
  // plain：排版已定型的位置塞不下按钮的底色虚线——只给一根 span，唯一样式 cursor: copy。
  // 气泡完全受控于「已复制」态（open 由 copied 驱动）：不点击永远不出现（悬停也不出），
  // 点击且写剪贴板成功后才弹「已复制」；写失败不弹（不谎报成功，口径与非 plain 一致）。
  if (plain) {
    return (
      <Tooltip title="已复制到剪贴板" open={copied}>
        <span
          data-testid={testId}
          data-copied={copied ? 'true' : undefined}
          style={{ cursor: 'copy' }}
          onClick={onClick}
        >
          {children}
        </span>
      </Tooltip>
    );
  }
  // 底色：默认透明（不占视觉）→ 悬停 controlItemBgHover → 复制瞬间 controlItemBgActive。
  // 用「始终画底色、只换颜色」而不是条件挂载，鼠标进出不会引起重排
  const background = copied ? token.controlItemBgActive : hover ? token.controlItemBgHover : 'transparent';
  const style: CSSProperties = {
    display: 'inline-block',
    maxWidth: '100%',
    padding: 0,
    border: 'none',
    // 虚线提示「可点」：不占布局高度（border 替代 text-decoration，后者在换行处会画得断断续续）
    borderBottom: `1px dashed ${hover || copied ? token.colorPrimaryBorder : token.colorSplit}`,
    background,
    color: 'inherit',
    font: 'inherit',
    fontFamily: mono ? 'Menlo, Consolas, monospace' : 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    // 正文类内容要保留原始换行（git 提交信息是 pre-wrap 语义）
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  return (
    <Tooltip title={copied ? '已复制到剪贴板' : hint}>
      <button
        type="button"
        data-testid={testId}
        data-copied={copied ? 'true' : undefined}
        style={style}
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
      >
        {children}
        {/* 图标恒占位（opacity 切换）：进出悬停不改变文本折行位置 */}
        <span
          aria-hidden
          style={{ marginInlineStart: 4, opacity: hover || copied ? 1 : 0, color: copied ? token.colorSuccess : token.colorTextTertiary }}
        >
          {copied ? <CheckOutlined /> : <CopyOutlined />}
        </span>
      </button>
    </Tooltip>
  );
}
