/**
 * 注解行表：单文件逐行责任归属（原 composite/blame-view 的行渲染职责，迁出成独立组件）。
 *
 * 行 = 行号 | 时间 | 哈希 | **逐行语法高亮的代码内容**（用户口径：作者不占列，移入哈希浮层）。
 * 交互（用户口径：**整行可点击、只做点击不做 hover**）：
 *   · 点**行的任何位置**（含哈希文本）→ 选中该行归属的提交（中栏同步高亮、右栏另两个差异标签换到那一版）
 *     **并且**在该行哈希旁开/收提交详情浮层——一次点击把"这一行是谁写的"和"那次提交说了什么"一起给到；
 *   · 浮层仍以**哈希**为锚点（placement rightTop），位置不因"整行可点"而改变；
 *   · 再点同一行收起浮层；点另一行则浮层挪到那一行（数据由容器按哈希注入）。
 * 行内不再有任何按钮：哈希是只读 code 文本，整行才是唯一可聚焦入口（role=button + Enter/Space）——
 * 这样既没有"每行一个 Tab 停靠点"的成本（上千行时 Tab 要按上千次），也没有 antd 按钮的 hover 高亮
 * （口径要求移入不高亮）。鼠标移入唯一的反馈是 `cursor: pointer`。
 * 未提交行（全 0 伪哈希）不是提交：整行不可点、不可聚焦、不弹浮层（哈希只作为文本展示）。
 *
 * 高亮源文本由注解行按行拼回：`BlameLine.content` 就是该版本的文件正文，不必再取一次全文
 * （也因此不会出现「高亮的是工作区、注解的是某一版」这类错配）。
 * 代码正文逐行渲染，不迁 Listy：行要按等宽字体与行号定宽严格对齐，列表行容器会把它切成一条条
 * 「列表项」（同页的中栏「提交记录」清单与「受影响文件」清单走 Listy，是因为它们是同质条目列表）。
 * 纯受控：数据与回调由容器注入（含浮层的 entry/loading/error）。
 */
import { useMemo, useState } from 'react';
import { Flex, Popover, Spin, theme, Typography } from 'antd';
import type { BlameLine, CommittedEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { HighlightedTokens, useHighlightedLines, type LineHighlighterLoader } from '../base/line-highlighter';
import { formatRelativeTime } from '../domain/format';
import { CommitDetailCard } from './commit-detail-card';

/** 工作区未提交行的伪哈希：git blame 的边界提交（仓库里不存在该对象；sha1/sha256 长度兼容） */
const ZERO_HASH_RE = /^0{40,64}$/;

/**
 * 时间列固定宽（右对齐）：相对时间的字数不固定（`刚刚` 2 字 ~ `59分钟前` 4 字），
 * 不定宽的话每行的时间段宽度各不相同，右侧的哈希与正文就会逐行错开——定宽是"右侧对齐"的前提。
 * 68px ≈ 4 个汉字（最长档 `12月前` / `59分钟前`）+ 一点余量。
 */
const TIME_COLUMN_WIDTH = 68;

/** 哈希浮层的数据：hash 为当前展开的那一行，其余字段由容器按该哈希拉取后注入 */
export interface BlameDetailState {
  hash: string;
  entry?: CommittedEntry | null;
  authorEmail?: string;
  loading?: boolean;
  error?: string;
}

export interface BlameAnnotateTableProps {
  lines?: BlameLine[];
  loading?: boolean;
  error?: string;
  /** 当前选中的提交：归属它的行加底色 */
  selectedHash?: string | null;
  /** 点行 → 选中该行归属的提交；缺省行只读（未提交行恒不可点） */
  onSelectCommit?: (hash: string) => void;
  /** 高亮语言（容器按文件路径推断：domain/language 的 languageForPath）；缺省按纯文本渲染 */
  language?: string;
  /** 高亮 loader 注入点（测试用 stub）；缺省懒加载真实 Shiki */
  highlightLoader?: LineHighlighterLoader;
  /** 详情浮层（受控）：由容器持有「当前展开了哪个哈希」与它的取数三态 */
  detail?: BlameDetailState | null;
  /** 点哈希 → 切换浮层（传 null 表示关闭）；缺省时哈希不可点（无死控件） */
  onToggleDetail?: (hash: string | null) => void;
}

export function BlameAnnotateTable({
  lines,
  loading,
  error,
  selectedHash,
  onSelectCommit,
  language,
  highlightLoader,
  detail,
  onToggleDetail,
}: BlameAnnotateTableProps): React.ReactNode {
  // 选中底色与哈希按钮走主题 token（暗色主题下硬编码浅色会过亮）
  const { token } = theme.useToken();
  /**
   * 浮层开在哪一行（本地瞬态 UI 态；数据仍由容器按 detail.hash 注入）。
   * **必须按行而不是按哈希**：一个提交通常拥有连续多行（冒烟实测 `b96148e` 占 3 行、`13a68f6` 占 48 行），
   * 若按「哈希命中」判定，点一次哈希会同时弹出 N 个内容相同的浮层（实测 3 个叠在一起）。
   */
  const [openLineno, setOpenLineno] = useState<number | null>(null);
  // 高亮源文本 = 注解行内容按行拼回（hook 必须无条件调用：早退分支在其后）
  const code = useMemo(() => (lines === undefined ? '' : lines.map((line) => line.content).join('\n')), [lines]);
  const highlighted = useHighlightedLines({ code, language: language ?? 'plaintext' }, highlightLoader);
  if (loading === true) return <Spin data-testid="blame-loading" />;
  if (error !== undefined) {
    return (
      <Typography.Text type="danger" data-testid="blame-error">
        {error}
      </Typography.Text>
    );
  }
  if (lines === undefined || lines.length === 0) return <EmptyState title="暂无溯源信息" />;
  // 行数不一致时整份退纯文本：着色错位比没有着色更误导（判据只在渲染处取一次，避免逐行分支）
  const tokenLines = highlighted !== null && highlighted.length === lines.length ? highlighted : null;
  return (
    <Flex vertical style={{ minWidth: 0 }}>
      {lines.map((line) => {
        const pending = ZERO_HASH_RE.test(line.hash);
        const selected = selectedHash !== undefined && selectedHash !== null && selectedHash === line.hash;
        const clickable = !pending && (onSelectCommit !== undefined || onToggleDetail !== undefined);
        // 开 = 「就是这一行被点了」且容器已把该哈希的数据（或三态）注入进来；容器收起 detail 时这里自然关闭
        const open = openLineno === line.lineno && detail !== undefined && detail !== null && detail.hash === line.hash;
        /**
         * 整行唯一入口：选中该提交（注入了才调）+ 开/收该行的详情浮层（注入了才开）。
         * 开合判据取本轮渲染的 `open`：同一次点击只 toggle 一次——浮层自身的 `onOpenChange` 刻意不接，
         * 否则哈希文本的一次点击会被「行点击 + 浮层自身」各 toggle 一遍，开了立刻又关。
         */
        const activate = clickable
          ? () => {
            onSelectCommit?.(line.hash);
            if (onToggleDetail !== undefined) {
              const next = !open;
              setOpenLineno(next ? line.lineno : null);
              onToggleDetail(next ? line.hash : null);
            }
          }
          : undefined;
        // 行是「逐行注解」标签页里唯一的选择入口（旧版是 antd Button，可聚焦、可回车激活），
        // 一旦只留鼠标点击，纯键盘用户就够不到主功能——故可点行给 role="button" + tabIndex 0 + Enter/Space。
        // 不可点行不给 role/tabIndex：免得 Tab 停在一个按了也没反应的死控件上
        const onKeyDown =
          activate === undefined
            ? undefined
            : (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              // Space 的默认行为是滚动页面（行在视口内会把正文顶走）：拦掉，只留激活
              if (event.key === ' ') event.preventDefault();
              activate();
            };
        return (
          <Flex
            key={line.lineno}
            data-testid={`blame-line-${line.lineno}`}
            data-selected={selected ? 'true' : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            align="center"
            gap={8}
            style={{
              padding: '2px 0',
              ...(clickable ? { cursor: 'pointer' } : {}),
              ...(selected ? { background: token.controlItemBgActive } : {}),
            }}
            onClick={activate}
            onKeyDown={onKeyDown}
          >
            <Typography.Text type="secondary" style={{ width: 48, textAlign: 'right', flexShrink: 0 }}>
              {line.lineno}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              data-testid={`blame-time-${line.lineno}`}
              style={{ width: TIME_COLUMN_WIDTH, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {formatRelativeTime(line.dateIso)}
            </Typography.Text>
            {/* 哈希：只读 code 文本（不再是按钮——整行才是点击目标，行内因此没有任何 Tab 停靠点）。
                浮层仍以**它**为锚点（rightTop），故 Popover 包在这里；开合由整行点击驱动：受控 open，
                刻意不接 onOpenChange（接了就会与行点击各 toggle 一次，开了立刻又关）。 */}
            {!pending && onToggleDetail !== undefined ? (
              <Popover
                trigger="click"
                placement="rightTop"
                open={open}
                content={<CommitDetailCard entry={detail?.entry} authorEmail={detail?.authorEmail} {...(detail?.loading !== undefined ? { loading: detail.loading } : {})} {...(detail?.error !== undefined ? { error: detail.error } : {})} />}
              >
                <Typography.Text code data-testid={`blame-hash-${line.lineno}`}>
                  {line.shortHash}
                </Typography.Text>
              </Popover>
            ) : (
              // 未提交行（全 0 伪哈希，不是提交）或未注入浮层回调：纯文本，不给任何交互语义
              <Typography.Text code type={pending ? 'secondary' : undefined} data-testid={`blame-hash-${line.lineno}`}>
                {line.shortHash}
              </Typography.Text>
            )}
            <span
              className="rebased-line"
              data-testid={`blame-code-${line.lineno}`}
              style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'pre', fontFamily: 'monospace' }}
            >
              {tokenLines === null ? line.content : <HighlightedTokens tokens={tokenLines[line.lineno - 1] ?? []} />}
            </span>
          </Flex>
        );
      })}
    </Flex>
  );
}
