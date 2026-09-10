/**
 * git CLI 执行原语：参数数组防注入、强制无分页、LC_ALL=C、可取消。
 * 平台差异（Windows 杀进程树）集中在本文件处理。
 *
 * GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS=''：禁止 git 向终端或 askpass 索要凭据——
 * 无凭据的 HTTPS 操作立即以 'terminal prompts disabled' 失败（进上层 AUTH_FAILED 检测路径），
 * 而非挂起等待永不到来的输入（Windows 下 git 可经 CONIN$ 打开控制台无限阻塞，实测 30s 超时被迫杀进程）。
 * GCM_INTERACTIVE=never：Git Credential Manager（Windows 常见全局 credential.helper=manager）不受
 * GIT_TERMINAL_PROMPT 约束——401 时会弹交互 UI 无限挂起（本机实测复现）；never 模式下
 * GCM 有已存凭据照常返回、无凭据即刻失败回落 git 自身检测路径，两全。
 */
import { spawn } from 'node:child_process';

export interface GitResult {
  stdout: string;
  stderr: string;
}

/** 两处 spawn（runGit/streamGit）共用的固定 env：LC_ALL=C 固定英文输出；其余防交互挂起（见文件头） */
const GIT_ENV = { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GCM_INTERACTIVE: 'never' };

/** 命令执行日志条目：args 为 buildArgs 之后的最终参数数组（token 剥离后）；stderrTail 为输出尾部 ≤500 字符；atIso 为执行时间 */
export interface ExecLogEntry {
  args: string[];
  exitCode: number;
  durationMs: number;
  stderrTail: string;
  atIso: string;
}

/** git 可执行文件检测（GitExecutableSelectorPanel 语义）：Web 服务进程统一经 PATH 查找 'git'——
 *  version 为 git --version 输出；不可执行 → { exec:'git', version:null, ok:false }（引导到 PATH 配置） */
export async function resolveGitExecutableInfo(): Promise<{ exec: string; version: string | null; ok: boolean }> {
  try {
    const { stdout } = await runGit(['--version'], { cwd: process.cwd() });
    const version = stdout.trim();
    return { exec: 'git', version, ok: version.startsWith('git version') };
  } catch {
    return { exec: 'git', version: null, ok: false };
  }
}

/** 环形缓冲容量：每个仓库（按 cwd 键控）最多保留最近 200 条 */
const EXEC_LOG_CAP = 200;
/** 仓库级缓冲上限（LRU 淘汰）：Web 长驻进程打开仓库逐增，防 Map 无界增长（§2.5 硬化） */
const EXEC_LOG_DIRS_LIMIT = 64;
const execLogByCwd = new Map<string, ExecLogEntry[]>();

/** LRU 提升 + 超限淘汰：访问（写/读）即删后重插置尾；超限删最旧（Map 迭代序 = 插入序） */
function touchExecLogCwd(cwd: string): void {
  const list = execLogByCwd.get(cwd);
  if (list !== undefined) execLogByCwd.delete(cwd);
  while (execLogByCwd.size >= EXEC_LOG_DIRS_LIMIT) {
    const oldest = execLogByCwd.keys().next().value;
    if (oldest === undefined) break;
    execLogByCwd.delete(oldest);
  }
  if (list !== undefined) execLogByCwd.set(cwd, list);
}

function tail500(text: string): string {
  return text.length > 500 ? text.slice(text.length - 500) : text;
}

/** token 剥离：-c 后值匹配 /extraheader=/i（大小写不敏感——git config 键大小写不敏感，
 *  P3-A buildAuthConfig 注入形态 http.<authority>.extraHeader=... 可能任意大小写）→ 该
 *  -c 与值两个元素均不进日志；其余原样保留。token 文本绝不落盘。 */
function stripSensitivePairs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' && i + 1 < args.length && /extraheader=/i.test(args[i + 1])) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function recordExec(cwd: string, finalArgs: string[], exitCode: number, durationMs: number, stderr: string): void {
  touchExecLogCwd(cwd);
  let list = execLogByCwd.get(cwd);
  if (list === undefined) {
    list = [];
    execLogByCwd.set(cwd, list);
  }
  list.push({ args: stripSensitivePairs(finalArgs), exitCode, durationMs, stderrTail: tail500(stderr), atIso: new Date().toISOString() });
  if (list.length > EXEC_LOG_CAP) list.shift();
}

/** 按 cwd 键控的环形缓冲（cap 200/仓库；目录上限 64 LRU）；runGit/streamGit 成功与失败均记录（失败含非零退出；spawn 失败 exitCode -1）
 *  limit 截断：返回最近 limit 条（旧→新）。 */
export function getExecLog(cwd: string, limit: number): ExecLogEntry[] {
  if (limit <= 0) return [];
  touchExecLogCwd(cwd);
  return (execLogByCwd.get(cwd) ?? []).slice(-limit);
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

function buildArgs(args: string[], extraConfig?: string[]): string[] {
  // extraConfig 逐项作为一个 -c <entry> 注入，位于既有 -c core.pager=cat 之后、命令参数之前
  // （同 key 后出覆盖先出，调用方配置优先；token 注入的唯一通道——进程参数可见性为已知接受面，见计划安全约束）
  const extra = (extraConfig ?? []).flatMap((entry) => ['-c', entry]);
  return ['--no-pager', '-c', 'core.pager=cat', ...extra, ...args];
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

/** 执行 git 并收集完整输出（小输出场景）。
 *  timeoutMs 可选项：超时杀进程并以退出码 124 拒绝（防 git 传输 helper 挂起——如 Windows msys2 并发初始化失败导致 clone 无限等待）。
 *  input 可选项：写入 child.stdin 后 end（git apply、hash-object --stdin 等从 stdin 读数据的命令用）。
 *  extraConfig 可选项：逐项以 -c <entry> 注入（见 buildArgs）。
 *  env 可选项：调用方注入的额外环境变量（如交互式变基的 GIT_SEQUENCE_EDITOR/REBASED_TODO_FILE）；
 *  合并顺序 process.env → opts.env → GIT_ENV——固定防挂起项（GIT_TERMINAL_PROMPT 等）不可被注入覆盖。 */
export function runGit(
  args: string[],
  opts: { cwd: string; signal?: AbortSignal; timeoutMs?: number; input?: string; extraConfig?: string[]; env?: Record<string, string> },
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const finalArgs = buildArgs(args, opts.extraConfig);
    const startedAt = Date.now();
    // 每条命令恰好记录一次：close 覆盖成功/非零退出/中止(130)/超时(124)；error 覆盖 spawn 失败（exitCode -1）
    let recorded = false;
    const recordOnce = (exitCode: number, stderr: string): void => {
      if (recorded) return;
      recorded = true;
      recordExec(opts.cwd, finalArgs, exitCode, Date.now() - startedAt, stderr);
    };
    const child = spawn('git', finalArgs, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, ...GIT_ENV },
      windowsHide: true,
    });
    if (opts.input !== undefined) {
      // 子进程可能提前退出（参数错误等），stdin 写会遇到 EPIPE；
      // 忽略之，成败统一由 close 事件按退出码裁决，不另立失败路径。
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input);
    }
    let stdout = '';
    let stderr = '';
    let aborted = false;
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        if (child.exitCode === null && child.pid !== undefined) killTree(child.pid);
      }, opts.timeoutMs);
    }
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const onAbort = () => {
      // exitCode 在进程退出后即被赋值：已退出的进程绝不再 killTree，
      // 防止 Windows 上 pid 复用导致误杀无关进程树。
      if (child.exitCode === null) killTree(child.pid!);
      // 中止必须保证拒绝：命令可能恰好在 abort 瞬间成功退出（竞态），
      // 此时 close 事件不会带来失败；标记中止，close 后以约定的中止退出码拒绝。
      aborted = true;
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      // spawn 失败（git 缺失、cwd 不存在等）：无进程、无 close 事件，记 exitCode -1（stderrTail 记错误消息尾部）
      recordOnce(-1, e.message);
      reject(e);
    });
    child.on('close', (code) => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      // close 后 abort 事件若再来（或悬挂）不再触发 killTree
      opts.signal?.removeEventListener('abort', onAbort);
      recordOnce(aborted ? 130 : timedOut ? 124 : (code ?? 1), stderr);
      // 中止优先于退出码：即使子进程恰好以 0 退出，也要按取消语义拒绝
      if (aborted) reject(new GitExitError(args, 130, stdout, stderr));
      else if (timedOut) reject(new GitExitError(args, 124, stdout, stderr));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new GitExitError(args, code ?? 1, stdout, stderr));
    });
  });
}

/** 流式执行 git（大输出场景：log 图、diff），逐块产出 stdout 文本。
 *  取消语义与 runGit 对齐：abort 后绝不正常完成，统一以 exitCode 130 拒绝；
 *  消费者提前 break 时杀子进程树并清理监听，避免悬挂。
 *  env 可选项：调用方注入的额外环境变量，合并顺序与 runGit 完全一致
 *  （process.env → opts.env → GIT_ENV，固定防挂起项不可被注入覆盖）。 */
export async function* streamGit(
  args: string[],
  opts: { cwd: string; signal?: AbortSignal; env?: Record<string, string> },
): AsyncGenerator<string, void, unknown> {
  const finalArgs = buildArgs(args);
  // 预检：signal 已中止则不启动进程
  if (opts.signal?.aborted) {
    recordExec(opts.cwd, finalArgs, 130, 0, '');
    throw new GitExitError(args, 130, '', '');
  }
  const startedAt = Date.now();
  const child = spawn('git', finalArgs, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, ...GIT_ENV },
    windowsHide: true,
  });
  let stderr = '';
  let aborted = false;
  // spawn 失败（git 缺失、cwd 不存在等）时进程不会产生，'close' 不会触发；
  // 监听 'error' 记下失败并以 null 关闭等待，避免 'error' 无监听导致进程崩溃。
  let spawnError: Error | undefined;
  const onAbort = (): void => {
    aborted = true;
    // 进程已退出则绝不动其 pid（Windows PID 复用风险）；spawn 失败时 pid 为 undefined，同样跳过
    if (child.exitCode === null && child.pid !== undefined) killTree(child.pid);
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const closed: Promise<number | null> = new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (e: Error) => {
      spawnError = e;
      resolve(null);
    });
  });
  child.stdout.setEncoding('utf8');

  let completed = false;
  try {
    for await (const chunk of child.stdout) {
      yield chunk;
    }
    completed = true;
  } catch (e) {
    // stdout 流异常（罕见，如管道损坏）：记 exitCode -1（错误消息尾部），保留原始异常传播
    recordExec(opts.cwd, finalArgs, -1, Date.now() - startedAt, e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
    // 仅消费者提前退出（break/throw）时杀进程；自然结束不动已退出 pid；spawn 失败时 pid 为 undefined，跳过
    if (!completed && child.exitCode === null && child.pid !== undefined) killTree(child.pid);
  }
  const code = await closed;
  if (aborted || spawnError || code !== 0) {
    // 生成失败（非零退出/中止/spawn 失败）记一次：spawn 失败 stderrTail 记错误消息尾部
    recordExec(opts.cwd, finalArgs, aborted ? 130 : spawnError ? -1 : (code ?? 1), Date.now() - startedAt, spawnError ? spawnError.message : stderr);
    throw new GitExitError(args, aborted ? 130 : (code ?? 1), '', stderr);
  }
  recordExec(opts.cwd, finalArgs, 0, Date.now() - startedAt, stderr);
}
