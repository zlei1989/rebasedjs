/** 控制台功能：core 执行日志的薄映射——按原序（旧→新）透出，id=下标+1（返回窗口内最早 id=1）；显示顺序为旧→新（最新在底）。 */
import { getExecLog } from '@rebased/core';
import type { ConsoleEntry } from '@rebased/contracts';

/**
 * cwd 键控一致（T2 终审）：repoPath 原样透传 core getExecLog，不做任何规范化——
 * 与运行命令时记录的 cwd key 完全同串，路由 resolveRepo 的产物即可直接查回。
 * args 为缓冲共享引用（core 已做 token 剥离），只读处理，不改动。
 */
export async function getConsole(repoPath: string, limit: number): Promise<ConsoleEntry[]> {
  return getExecLog(repoPath, limit).map((e, i) => ({
    id: i + 1,
    args: e.args,
    exitCode: e.exitCode,
    durationMs: e.durationMs,
    stderrTail: e.stderrTail,
    atIso: e.atIso,
  }));
}
