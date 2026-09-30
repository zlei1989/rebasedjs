/**
 * 只读代码视图：历史版本里某个文件的全文（Monaco 只读编辑器 + 按文件类型语法高亮）。
 * 做什么：给「浏览快照」的文件内容一栏用——**用编辑器渲染代码**，于是自带行号、缩进参考线、
 *        当前行高亮、语法着色与横向滚动；不再是自绘 `<pre>` + 手算行号栏。
 * 为什么换成 Monaco：手绘版本要自己解决「行号栏宽度随行数变化」「长行横滚时行号不能留在原地」
 *        「关键字着色」三件事，而编辑器本来就把这些做对了；本仓已有 Monaco 基础设施
 *        （base/monaco-lazy：worker 装配、主题跟随、懒加载），复用它比继续维护自绘渲染器划算。
 * 怎么做：
 *   · 懒加载 + loader 注入点与 MonacoTextView/MonacoDiffView 同一手法（测试注入 stub 绕过真实 monaco）；
 *   · `language` 由调用方按文件路径给（见 domain/language），拿不到就 plaintext；
 *   · 编辑器宿主必须是**高度确定**的盒子（Monaco 按宿主尺寸布局）：根节点纵向 flex、
 *     宿主 `flex: 1 + minHeight: 0`，于是它自适应栏的可见高度而不是按内容撑开；
 *   · 空态/加载/错误/二进制四种情况都不渲染编辑器（没有可显示的内容时没必要起一个编辑器实例）。
 * 注意：`options` 里关掉 minimap 与「滚到末尾」之类的交互噪声，保留行号与高亮；
 *      只读由 `readOnly: true` 与 options 双重给出（前者是组件语义、后者是编辑器行为）。
 */
import { AlignLeftOutlined, CopyOutlined, DiffOutlined } from '@ant-design/icons';
import { Button, Flex, Spin, Tooltip, Typography } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { EmptyState } from './empty-state';
import { MonacoTextView } from './monaco-text-view';
import { languageForPath } from '../domain/language';
import type { MonacoLazyLoader } from './monaco-lazy';

/** 一个等宽字符的像素宽度兜底值：canvas 实测拿不到（jsdom/SSR）时用它
 *  （全站紧凑密度下 fontSizeSM 12px 的等宽字形实测约 7.83px）。
 *  调用方（日志页）据此把「快照栏默认 100 字符宽」折算成像素初值——
 *  两边必须是同一个数字，否则初值与实际观感会互相打架。 */
export const FALLBACK_CHAR_WIDTH = 7.83;

export interface ReadonlyTextViewProps {
  /** 文件路径；`undefined` = 还没选文件（空态）。同时用于推断高亮语言 */
  path?: string;
  /** 文件全文（未就绪/空态时缺省） */
  content?: string;
  loading?: boolean;
  error?: string;
  /** 二进制文件：只提示不渲染（对齐既有口径） */
  binary?: boolean;
  /**
   * 复制反馈文案（由调用方在点「复制全文」后置位、按时清空）。
   * 为什么由外部给：复制按钮长在文件标签的路径栏里（调用方渲染），
   * 而提示文案要落在正文区——两地分属不同组件，状态只能由共同的调用方持有。
   */
  copyHint?: string | null;
  /** Monaco 懒加载注入点（测试传 stub 绕过真实 monaco）；缺省用真实编辑器 */
  loader?: MonacoLazyLoader;
  /** 覆盖语言推断（缺省按 path 推断，推不出用 plaintext） */
  language?: string;
}

export function ReadonlyTextView({
  path,
  content,
  loading,
  error,
  binary,
  copyHint,
  loader,
  language,
}: ReadonlyTextViewProps): ReactNode {
  // 语言只在 path 变化时重算：它是编辑器重建的依赖之一（换语言要换模型）
  const resolvedLanguage = useMemo(() => language ?? languageForPath(path) ?? 'plaintext', [language, path]);
  return (
    /* 根节点纵向 flex + 高度确定：编辑器宿主吃满「栏的可见高度」，内容再长也只在编辑器内部滚动，
       不按内容高度把这一栏撑开（用户口径：自适应可见区域高度） */
    <Flex vertical style={{ height: '100%', minHeight: 0, position: 'relative' }}>
      {body()}
      {/* 复制结果的一次性反馈（成功/失败各一句）：贴在正文下方浮起，不为一句两秒就消失的提示挤压正文 */}
      {copyHint === null || copyHint === undefined ? null : (
        <Typography.Text
          type="secondary"
          data-testid="browse-copy-hint"
          style={{ position: 'absolute', insetInlineStart: 8, insetBlockEnd: 4 }}
        >
          {copyHint}
        </Typography.Text>
      )}
    </Flex>
  );

  /** 正文区：四种无内容状态给占位，其余交给 Monaco 只读编辑器 */
  function body(): ReactNode {
    if (path === undefined) return <EmptyState title="在左侧选择文件查看内容" />;
    if (loading === true) return <Spin data-testid="browse-content-loading" />;
    if (error !== undefined) {
      return (
        <Typography.Text type="danger" data-testid="browse-content-error">
          {error}
        </Typography.Text>
      );
    }
    if (binary === true) {
      return (
        <Typography.Text type="warning" data-testid="browse-binary">
          二进制文件，不支持文本预览
        </Typography.Text>
      );
    }
    if (content === undefined) return null;
    /* 编辑器宿主：`flex: 1 + minHeight: 0` 是它「自适应可见高度」的全部秘密——
       换成 height:100% 在 flex 列里会解析成 auto，编辑器就会按内容长高（实测近万像素） */
    return (
      <div data-testid="browse-code-editor" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <MonacoTextView
          value={content}
          language={resolvedLanguage}
          readOnly
          options={{
            readOnly: true,
            minimap: { enabled: false },
            // 只读浏览不需要「光标在末尾/滚动超出末尾」这类编辑手感
            scrollBeyondLastLine: false,
            // 行号恒开：这是代码视图，行号是定位基准
            lineNumbers: 'on',
            // 长行不折行（折行会让缩进与对齐失真），由编辑器横向滚动兜底
            wordWrap: 'off',
            renderLineHighlight: 'line',
            fontSize: 14,
            automaticLayout: true,
          }}
          loader={loader}
        />
      </div>
    );
  }
}

/**
 * 文件标签路径栏右侧的动作按钮：**两个视图切换图标按钮**（逐行注解 / 与最新版本差异）+ 复制全文
 * （与路径同处一条栏，见 composite/snapshot-tabs）。
 * 用户口径（2026-09-30）：两个按钮的文字写进 tooltip、点击后高亮、下方内容切换成对应的视图——
 * 故这里只做「画按钮 + 上报点击」，视图状态与内容切换由调用方（快照标签栏）持有；再点一次已点亮的按钮
 * 即回**文件内容**（切换语义，与「点亮态再点一次取消」的直觉一致，故不额外长一个「文件内容」按钮）。
 * 用户口径：不再提供「在新标签页打开该文件快照页」那个导出按钮——整页 browse 形态仍可从
 * 详情面板「浏览快照」与地址栏 ?rev= 直达，不必在这里再开一个入口。
 */

/**
 * 快照文件标签的视图（与日志页地址栏 `?view=` 同一取值域，读写见两端 src/url-select）：
 *   · `plain`    —— 该版本的文件内容（缺省）；
 *   · `annotate` —— 逐行注解（逐行归属，数据由容器经 useBlame 条件拉取）；
 *   · `latest`   —— 与最新版本（**工作区当前版本**）差异（两端全文，数据由容器经 useFileDiff 条件拉取）。
 * 定义放在这里（而不是快照标签栏里）是为了**分层**：本文件是 base 层，不能反向 import composite 的类型。
 */
export type SnapshotFileView = 'plain' | 'annotate' | 'latest';

export function ReadonlyTextActions({
  content,
  binary,
  onCopyAll,
  view,
  onViewChange,
}: {
  content?: string;
  binary?: boolean;
  /** 复制全文回调（反馈文案由调用方渲染在正文区，按钮与提示分处两地） */
  onCopyAll?: () => void;
  /** 当前视图（`plain` = 文件内容）；与 onViewChange 同传时才渲染那两个图标按钮 */
  view?: SnapshotFileView;
  /** 切换视图回调（按钮按自己的值回调；调用方把同值再点一次解释为回 `plain`） */
  onViewChange?: (view: SnapshotFileView) => void;
}): ReactNode {
  /**
   * 两个视图按钮的文案与说明（**文字只进 tooltip**，按钮本身只有图标——用户口径 2026-09-30）。
   * 高亮态：点亮 = 当前视图就是它（`type="primary"`）。用 `type` 而不是自写背景色，
   * 是为了让 antd 自己处理 hover/按下/暗色主题下的对比度（本仓「样式一律走 antd」的口径）。
   */
  const toggles: { key: Exclude<SnapshotFileView, 'plain'>; label: string; tip: string; icon: ReactNode }[] = [
    {
      key: 'annotate',
      label: '逐行注解',
      tip: '逐行注解：看这一版里每一行分别由哪次提交写下的；点某一行可选中它归属的提交',
      icon: <AlignLeftOutlined />,
    },
    {
      key: 'latest',
      label: '与最新版本差异',
      tip: '与最新版本差异：该版本与此文件当前版本（含未提交改动）逐行对比',
      icon: <DiffOutlined />,
    },
  ];
  return (
    <>
      {onViewChange === undefined ? null : toggles.map((item) => (
        /* placement 固定在右下：这两个按钮长在**路径栏最右端**，默认的 top 居中会把这条较长的文案
           顶到视口右缘之外（浏览器实测被裁掉半句）。右下有整块正文空间可落，且不遮路径栏本身。 */
        <Tooltip key={item.key} title={item.tip} placement="bottomRight">
          <Button
            size="small"
            icon={item.icon}
            type={view === item.key ? 'primary' : 'default'}
            aria-label={item.label}
            aria-pressed={view === item.key}
            data-testid={`browse-view-${item.key}`}
            data-active={view === item.key ? 'true' : 'false'}
            onClick={() => onViewChange(view === item.key ? 'plain' : item.key)}
          />
        </Tooltip>
      ))}
      <Tooltip title="复制该文件的完整内容到剪贴板">
        <span>
          <Button
            size="small"
            icon={<CopyOutlined />}
            data-testid="browse-copy-all"
            disabled={content === undefined || binary === true}
            onClick={onCopyAll}
          />
        </span>
      </Tooltip>
    </>
  );
}
