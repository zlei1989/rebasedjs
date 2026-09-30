/**
 * 注解行表：单文件逐行责任归属（原 composite/blame-view 的行渲染职责，迁出成独立组件）。
 *
 * 行 = 行号 | 时间 | 哈希 | **逐行语法高亮的代码内容**（用户口径：作者不占列，移入哈希浮层）。
 * 两个入口，互不代劳（用户口径）：
 *   · 点**哈希** → 打开该提交的详情浮层（Placement rightTop；完整提交信息、作者与邮箱、父提交）；
 *     浮层跟着**被点的那一行**（同一提交常拥有连续多行，见组件内 openLineno 的说明）；
 *   · 点**行的其他位置** → 选中该行归属的提交——「这行是谁写的 → 那次提交改了什么」的主链路不变
 *     （中栏同步高亮、右栏另两个差异标签换到那一版）。浮层与选中都不走 hover：键盘用户同样够得到
 *     （哈希是原生 button，行是 role=button + Enter/Space）。
 * 键盘：行内控件（哈希）上的按键**不由行代劳**（判 target !== currentTarget），否则在哈希上按回车
 * 会同时弹浮层又选中提交——一次按键两个后果，用户无法预期。
 *
 * 工作区未提交行由 git 给出全 0 伪哈希（core 的边界口径），它不是真实提交：**不可点**（点了会把
 * 0000… 写进 ?select=、或向 /commits/0000… 发一个必 400 的请求），也不再有「未提交」文案
 * （用户口径：行内只留 行号｜时间｜哈希）。这类行的高亮内容是工作区真实文本，照常着色。
 *
 * 高亮源文本由注解行按行拼回：`BlameLine.content` 就是该版本的文件正文，不必再取一次全文
 * （也因此不会出现「高亮的是工作区、注解的是某一版」这类错配）。
 * 代码正文逐行渲染，不迁 Listy：行要按等宽字体与行号定宽严格对齐，列表行容器会把它切成一条条
 * 「列表项」（同页的中栏「提交记录」清单与「受影响文件」清单走 Listy，是因为它们是同质条目列表）。
 * 纯受控：数据与回调由容器注入（含浮层的 entry/loading/error）。
 */
import { useMemo, useState } from 'react';
import { Button, Flex, Popover, Spin, theme, Typography } from 'antd';
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

/**
 * 哈希列固定宽：可点行渲染的是 antd Button（自带内边距，自然宽 68），未提交行渲染的是只读 Text
 * （自然宽 53）——不定宽的话这两类行的**正文左沿会差 15px**（冒烟实测 768 vs 753），
 * 一列里混着两类行时正文就是锯齿。定宽后两类行占同一列宽，正文逐行对齐。
 */
const HASH_COLUMN_WIDTH = 68;

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
        const clickable = !pending && onSelectCommit !== undefined;
        // 点行与键盘激活共用同一个入口：键鼠两路若各写一份判据，迟早漂移出「键盘能选未提交行」之类的不一致
        const activate = clickable ? () => onSelectCommit(line.hash) : undefined;
        const hashClickable = !pending && onToggleDetail !== undefined;
        // 开 = 「就是这一行被点了」且容器已把该哈希的数据（或三态）注入进来；容器收起 detail 时这里自然关闭
        const open = openLineno === line.lineno && detail !== undefined && detail !== null && detail.hash === line.hash;
        // 行是「逐行注解」标签页里唯一的选择入口（旧版是 antd Button，可聚焦、可回车激活），
        // 一旦只留鼠标点击，纯键盘用户就够不到主功能——故可点行给 role="button" + tabIndex 0 + Enter/Space。
        // 不可点行不给 role/tabIndex：免得 Tab 停在一个按了也没反应的死控件上
        const onKeyDown =
          activate === undefined
            ? undefined
            : (event: React.KeyboardEvent<HTMLDivElement>) => {
              // 行内控件（哈希按钮）自己的按键不代劳：它的回车/空格只切浮层
              if (event.target !== event.currentTarget) return;
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
            {/* 哈希列（定宽）：可点行是 Button、未提交行是只读 Text，两者自然宽不同——统一压到这个宽度，正文左沿才对齐 */}
            <Flex
              align="center"
              data-testid={`blame-hash-cell-${line.lineno}`}
              style={{ width: HASH_COLUMN_WIDTH, flexShrink: 0 }}
            >
              {hashClickable ? (
                <Popover
                  trigger="click"
                  placement="rightTop"
                  open={open}
                  onOpenChange={(next) => {
                    // 开合记在**这一行**上：同哈希的其余行不跟着开（点另一行 = 浮层挪过去）
                    setOpenLineno(next ? line.lineno : null);
                    onToggleDetail(next ? line.hash : null);
                  }}
                  content={<CommitDetailCard entry={detail?.entry} authorEmail={detail?.authorEmail} {...(detail?.loading !== undefined ? { loading: detail.loading } : {})} {...(detail?.error !== undefined ? { error: detail.error } : {})} />}
                >
                  {/* 原生 button：回车/空格天生就是 click，不必自己写键盘分支；样式走 antd（text 按钮 + code 文本） */}
                  <Button
                    type="text"
                    size="small"
                    data-testid={`blame-hash-${line.lineno}`}
                    // 哈希点击只切浮层：不冒泡到行，避免一次点击同时选中提交
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Typography.Text code>{line.shortHash}</Typography.Text>
                  </Button>
                </Popover>
              ) : (
                // 不可点（未提交行 / 未注入回调）：保持只读文本形态，不给按钮语义
                <Typography.Text code type={pending ? 'secondary' : undefined} data-testid={`blame-hash-${line.lineno}`}>
                  {line.shortHash}
                </Typography.Text>
              )}
            </Flex>
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
