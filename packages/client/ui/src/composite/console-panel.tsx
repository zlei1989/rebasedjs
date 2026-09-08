/**
 * Git 控制台面板：命令执行记录列表——时间（复用 formatCommitDate）+ args 单行 join(' ') +
 * 退出码徽标（0 绿 / 非 0 红，spawn 失败 -1 也红）+ 耗时（≤1000 显示 ms、>1000 显示 s）+
 * stderrTail 小字（无则省略）；「刷新」按钮调 onRefresh；loading 显 Spin；空态 EmptyState。
 *  args 显示折叠（GitConsoleFoldingImpl 语义）：连续 `-c key=value` 序列折叠为单个 `-c …`
 *  （core 日志已剥离 token 的 extraHeader 对，这里是普通 -c 配置项的可读性折叠）。
 *  纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入 hooks。
 */
import { Button, Card, Flex, Spin, Tag, Typography } from 'antd';
import type { ConsoleEntry } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { formatCommitDate } from '../domain/format';

export interface ConsolePanelProps {
  entries?: ConsoleEntry[];
  loading?: boolean;
  /** 刷新记录：缺省不渲染刷新按钮 */
  onRefresh?: () => void;
}

/** 耗时格式化：≤1000 显示 ms；>1000 显示 s（一位小数） */
function formatDuration(durationMs: number): string {
  return durationMs > 1000 ? `${(durationMs / 1000).toFixed(1)} s` : `${durationMs} ms`;
}

/**
 * args 显示折叠（GitConsoleFoldingImpl 语义）：`-c key=value` 参数对折叠为单个 `-c …`。
 *  仅成对（-c 后确有值）折叠；孤立的 -c 原样保留。纯函数导出供测试。
 */
export function foldArgs(args: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === '-c' && i + 1 < args.length) {
      out.push('-c …');
      i += 2;
    } else {
      out.push(args[i]);
      i += 1;
    }
  }
  return out.join(' ');
}

/** 命令记录行：时间 + args 折叠单行（弹性省略）+ 退出码徽标 + 耗时；stderrTail 在下方小字（无则省略） */
function ConsoleRow({ entry }: { entry: ConsoleEntry }): React.ReactNode {
  const ok = entry.exitCode === 0;
  return (
    <Flex vertical data-testid={`console-row-${entry.id}`} style={{ padding: '4px 0' }}>
      <Flex align="center" gap={8}>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
          {formatCommitDate(entry.atIso)}
        </Typography.Text>
        <Typography.Text style={{ flex: 1, minWidth: 0 }} ellipsis>
          {foldArgs(entry.args)}
        </Typography.Text>
        <Tag color={ok ? 'success' : 'error'} data-testid={`console-exit-${entry.id}`}>
          {entry.exitCode}
        </Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }} data-testid={`console-duration-${entry.id}`}>
          {formatDuration(entry.durationMs)}
        </Typography.Text>
      </Flex>
      {entry.stderrTail !== '' ? (
        <Typography.Text type="danger" style={{ fontSize: 12 }} data-testid={`console-stderr-${entry.id}`}>
          {entry.stderrTail}
        </Typography.Text>
      ) : null}
    </Flex>
  );
}

export function ConsolePanel({ entries, loading, onRefresh }: ConsolePanelProps): React.ReactNode {
  return (
    <Card
      size="small"
      title="Git 控制台"
      extra={
        onRefresh !== undefined ? (
          <Button size="small" data-testid="console-refresh" onClick={onRefresh}>
            刷新
          </Button>
        ) : undefined
      }
    >
      {loading ? (
        <Spin data-testid="console-loading" />
      ) : !entries || entries.length === 0 ? (
        <EmptyState title="暂无命令记录" />
      ) : (
        <Flex vertical>
          {entries.map((entry) => (
            <ConsoleRow key={entry.id} entry={entry} />
          ))}
        </Flex>
      )}
    </Card>
  );
}
