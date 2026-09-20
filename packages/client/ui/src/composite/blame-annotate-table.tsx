/**
 * 注解行表：单文件逐行责任归属（原 composite/blame-view 的行渲染职责，迁出成独立组件）。
 * 行 = 行号 | 提交短哈希 | 作者 | 日期 | 内容；**整行可点 = 选中该行归属的提交**（鼠标点击与键盘
 * Enter/Space 等效——行是唯一入口，键盘用户必须够得到）——
 * 这是「这行是谁写的 → 那次提交改了什么」的主链路（用户口径，见 design §1.4 / D7）。
 * 工作区未提交行由 git 给出全 0 伪哈希（core 的边界口径），它不是真实提交：
 * 标注「未提交」且**不可点**（点了会把 0000… 写进 ?select=，日志页拿着它选不中任何提交）。
 * 代码正文逐行渲染，不迁 Listy：行要按等宽字体与行号定宽严格对齐，列表行容器会把它切成一条条「列表项」
 * （与既有 blame-view 的口径一致）。纯受控：数据与回调由容器注入。
 */
import { Flex, Spin, theme, Typography } from 'antd';
import type { BlameLine } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

/** 工作区未提交行的伪哈希：git blame 的边界提交（仓库里不存在该对象；sha1/sha256 长度兼容） */
const ZERO_HASH_RE = /^0{40,64}$/;

export interface BlameAnnotateTableProps {
  lines?: BlameLine[];
  loading?: boolean;
  error?: string;
  /** 当前选中的提交：归属它的行加底色 */
  selectedHash?: string | null;
  /** 点行 → 选中该行归属的提交；缺省行只读（未提交行恒不可点） */
  onSelectCommit?: (hash: string) => void;
}

export function BlameAnnotateTable({
  lines,
  loading,
  error,
  selectedHash,
  onSelectCommit,
}: BlameAnnotateTableProps): React.ReactNode {
  // 选中底色走主题 token（暗色主题下硬编码浅色会过亮）
  const { token } = theme.useToken();
  if (loading === true) return <Spin data-testid="blame-loading" />;
  if (error !== undefined) {
    return (
      <Typography.Text type="danger" data-testid="blame-error">
        {error}
      </Typography.Text>
    );
  }
  if (lines === undefined || lines.length === 0) return <EmptyState title="暂无溯源信息" />;
  return (
    <Flex vertical style={{ minWidth: 0 }}>
      {lines.map((line) => {
        const pending = ZERO_HASH_RE.test(line.hash);
        const selected = selectedHash !== undefined && selectedHash !== null && selectedHash === line.hash;
        const clickable = !pending && onSelectCommit !== undefined;
        // 点行与键盘激活共用同一个入口：键鼠两路若各写一份判据，迟早漂移出「键盘能选未提交行」之类的不一致
        const activate = clickable ? () => onSelectCommit(line.hash) : undefined;
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
            <Typography.Text code data-testid={`blame-hash-${line.lineno}`} style={{ flexShrink: 0 }}>
              {line.shortHash}
            </Typography.Text>
            {pending ? (
              <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
                未提交
              </Typography.Text>
            ) : null}
            <Typography.Text style={{ width: 120, flexShrink: 0 }} ellipsis>
              {line.author}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
              {formatCommitDate(line.dateIso)}
            </Typography.Text>
            <Typography.Text style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }} ellipsis>
              {line.content}
            </Typography.Text>
          </Flex>
        );
      })}
    </Flex>
  );
}
