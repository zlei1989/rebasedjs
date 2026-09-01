/**
 * git CLI 执行原语：参数数组防注入、强制无分页、LC_ALL=C、可取消。
 * 平台差异（Windows 杀进程树）集中在本文件处理。
 */
import { spawn } from 'node:child_process';

export interface GitResult {
  stdout: string;
  stderr: string;
}

export class GitExitError extends Error {
  readonly args: string[];
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(args: string[], exitCode: number, stdout: string, stderr: string) {
    const firstLine = stderr.trim().split('\n')[0] ?? '';
    super(`git ${args.join(' ')} 退出码 ${exitCode}${firstLine ? `：${firstLine}` : ''}`);
    this.name = 'GitExitError';
    this.args = args;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function buildArgs(args: string[]): string[] {
  return ['--no-pager', '-c', 'core.pager=cat', ...args];
}

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    // Windows 无进程组信号，用 taskkill /T 杀整棵树
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 进程已退出 */
    }
  }
}

/** 执行 git 并收集完整输出（小输出场景） */
export function runGit(args: string[], opts: { cwd: string; signal?: AbortSignal }): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', buildArgs(args), {
      cwd: opts.cwd,
      env: { ...process.env, LC_ALL: 'C' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let aborted = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    opts.signal?.addEventListener(
      'abort',
      () => {
        killTree(child.pid!);
        // 中止必须保证拒绝：命令可能恰好在 abort 瞬间成功退出（竞态），
        // 此时 close 事件不会带来失败；标记中止，close 后以约定的中止退出码拒绝。
        aborted = true;
      },
      { once: true },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      // 中止优先于退出码：即使子进程恰好以 0 退出，也要按取消语义拒绝
      if (aborted) reject(new GitExitError(args, 130, stdout, stderr));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new GitExitError(args, code ?? 1, stdout, stderr));
    });
  });
}

/** 流式执行 git（大输出场景：log 图、diff），逐块产出 stdout 文本 */
export async function* streamGit(args: string[], opts: { cwd: string; signal?: AbortSignal }): AsyncIterable<string> {
  const child = spawn('git', buildArgs(args), {
    cwd: opts.cwd,
    env: { ...process.env, LC_ALL: 'C' },
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  opts.signal?.addEventListener('abort', () => killTree(child.pid!), { once: true });

  const exitCode: Promise<number | null> = new Promise((resolve) => child.on('close', resolve));
  child.stdout.setEncoding('utf8');
  for await (const chunk of child.stdout) {
    yield chunk;
  }
  const code = await exitCode;
  if (code !== 0) {
    throw new GitExitError(args, code ?? 1, '', stderr);
  }
}
