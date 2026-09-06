import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitExitError, getExecLog, runGit, streamGit } from './exec';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('runGit', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('在真实仓库执行 git 命令', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const r = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo });
    expect(r.stdout.trim()).toBe('true');
    expect(r.stderr).toBe('');
  });

  it('非零退出抛 GitExitError 并携带 stderr', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(runGit(['rev-parse', 'no-such-thing'], { cwd: repo })).rejects.toMatchObject({
      name: 'GitExitError',
      exitCode: 128,
    });
  });

  it('input 写入子进程 stdin（hash-object --stdin 得已知 blob 哈希）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const r = await runGit(['hash-object', '--stdin'], { cwd: repo, input: 'hello' });
    // 'hello'（无换行）的 blob 哈希；ce01362… 实为 'hello\n' 的哈希（echo 管道惯例所致）。
    // 断言 b6fc4c6… 同时证明 stdin 字节精确透传、未被追加换行。
    expect(r.stdout.trim()).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  });

  it('AbortSignal 终止进行中的命令', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    const p = runGit(['log', '--all'], { cwd: repo, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(GitExitError);
  });
});

describe('extraConfig 注入', () => {
  it('逐项以 -c 注入生效，且位于既有 core.pager=cat 之后（后出覆盖先出）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // buildArgs 固定注入 -c core.pager=cat；extraConfig 追加在其后，故调用方值覆盖默认值
    const pager = await runGit(['config', '--get', 'core.pager'], { cwd: repo, extraConfig: ['core.pager=less'] });
    expect(pager.stdout.trim()).toBe('less');
    // 任意配置项注入：core.abbrev 在本地 config 中不存在，唯一来源即 extraConfig
    const abbrev = await runGit(['config', '--get', 'core.abbrev'], { cwd: repo, extraConfig: ['core.abbrev=40'] });
    expect(abbrev.stdout.trim()).toBe('40');
  });
});

describe('防交互挂起（GIT_TERMINAL_PROMPT=0）', () => {
  it('无凭据 http 请求快速失败（terminal prompts disabled）而非挂起等输入', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // 本地 401 服务器模拟需认证的 HTTP 远程：git 收到 401 后会尝试索要凭据，
    // GIT_TERMINAL_PROMPT=0 使其立即失败（stderr 特征 'terminal prompts disabled'），
    // 缺失该 env 时 Windows 下 git 可经 CONIN$ 打开控制台无限挂起（超时退出码 124）。
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const err: unknown = await runGit(['ls-remote', `http://127.0.0.1:${port}/x.git`], { cwd: repo, timeoutMs: 30000 }).then(
        () => new Error('应当失败却成功了'),
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(GitExitError);
      const gerr = err as GitExitError;
      expect(gerr.exitCode).not.toBe(124); // 非超时：证明未挂起
      expect(gerr.stderr).toContain('terminal prompts disabled');
    } finally {
      server.close();
    }
  }, 40000);
});

describe('streamGit 取消语义', () => {
  it('env 注入透传给子进程（shell 别名读取环境变量）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // git 对 ! 开头的别名经 sh -c 展开，能读到 git 子进程 env（合并顺序见 exec.ts）：
    // 若 env 未注入，$REBASED_ENV 展开为空，输出不含 'bar'。
    let out = '';
    for await (const chunk of streamGit(['-c', 'alias.self=!echo $REBASED_ENV', 'self'], {
      cwd: repo,
      env: { REBASED_ENV: 'bar' },
    })) {
      out += chunk;
    }
    expect(out).toContain('bar');
  });

  it('已中止的 signal 预检：不启动进程直接抛 130', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    ac.abort();
    const collect = async (): Promise<string> => {
      let out = '';
      for await (const c of streamGit(['log'], { cwd: repo, signal: ac.signal })) out += c;
      return out;
    };
    await expect(collect()).rejects.toMatchObject({ name: 'GitExitError', exitCode: 130 });
  });

  it('进行中 abort：以 130 拒绝', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // upload-pack 读取 stdin，天然阻塞（无网络依赖）
    const ac = new AbortController();
    const collect = async (): Promise<string> => {
      let out = '';
      for await (const c of streamGit(['upload-pack', repo], { cwd: repo, signal: ac.signal })) out += c;
      return out;
    };
    const p = collect();
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'GitExitError', exitCode: 130 });
  });

  it('消费者 break：生成器干净结束（finally 杀进程，无悬挂）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const iter = streamGit(['upload-pack', repo], { cwd: repo });
    const first = await iter.next(); // 进程已启动并阻塞
    expect(first.done).toBe(false);
    await iter.return(undefined); // break 语义：finally 清理后结束
    // 仓库未被锁：后续 git 命令仍可执行
    await expect(runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo })).resolves.toMatchObject({ stdout: 'true\n' });
  });

  it('spawn 失败（cwd 不存在）以拒绝结束且不崩溃', async () => {
    const collect = async (): Promise<string> => {
      let out = '';
      for await (const c of streamGit(['log'], { cwd: join(tmpdir(), 'no-such-dir-xxx') })) out += c;
      return out;
    };
    await expect(collect()).rejects.toThrow();
  });
});

describe('getExecLog 环形缓冲', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('成功与失败均记录（失败记实际非零 exitCode，args 为 buildArgs 后的最终数组）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo });
    await expect(runGit(['rev-parse', 'no-such-rev'], { cwd: repo })).rejects.toBeInstanceOf(GitExitError);

    const log = getExecLog(repo, 10);
    expect(log).toHaveLength(2);
    expect(log[0].exitCode).toBe(0);
    expect(log[1].exitCode).toBe(128);
    expect(log[0].args).toContain('--no-pager');
    expect(log[0].args).toContain('rev-parse');
    expect(log[1].args).toContain('rev-parse');
    expect(typeof log[0].durationMs).toBe('number');
    expect(log[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(log[0].atIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(log[1].atIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(log[1].stderrTail.length).toBeGreaterThan(0);
  });

  it('limit 截断：只返回最近 N 条（旧→新）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await runGit(['rev-parse', '--show-toplevel'], { cwd: repo });
    await runGit(['rev-parse', '--show-prefix'], { cwd: repo });
    await runGit(['rev-parse', '--show-cdup'], { cwd: repo });

    const log = getExecLog(repo, 1);
    expect(log).toHaveLength(1);
    expect(log[0].args).toContain('--show-cdup');
  });

  it('token 剥离：-c 值含 extraHeader= 的整对不进日志（大小写不敏感）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // P3-A buildAuthConfig 注入形态 http.<authority>.extraHeader=...（大小写任意）；命令本身与 token 无关
    await runGit(['config', '--get', 'core.pager'], {
      cwd: repo,
      extraConfig: ['http.x.extraHeader=Authorization: Bearer SECRET123'],
    });

    const log = getExecLog(repo, 10);
    expect(log).toHaveLength(1);
    const args = log[0].args;
    const joined = args.join('\n');
    expect(joined).not.toContain('extraHeader');
    expect(joined).not.toContain('SECRET123');
    expect(args.filter((a) => a === '-c')).toHaveLength(1); // 仅余 buildArgs 固定的 core.pager=cat
  });

  it('spawn 失败记 exitCode -1（stderrTail 为错误消息尾部）', async () => {
    const bad = join(tmpdir(), `no-such-exec-dir-${Math.random().toString(36).slice(2)}`);
    await expect(runGit(['rev-parse'], { cwd: bad })).rejects.toThrow();

    const log = getExecLog(bad, 10);
    expect(log).toHaveLength(1);
    expect(log[0].exitCode).toBe(-1);
    expect(log[0].stderrTail.length).toBeGreaterThan(0);
  });

  it('streamGit 成功与失败均记录（每条一次，非逐 chunk）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    let out = '';
    for await (const c of streamGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo })) out += c;
    expect(out.trim()).toBe('true');
    const collect = async (): Promise<void> => {
      for await (const c of streamGit(['rev-parse', 'no-such-rev'], { cwd: repo })) void c;
    };
    await expect(collect()).rejects.toBeInstanceOf(GitExitError);

    const log = getExecLog(repo, 10);
    expect(log.map((e) => e.exitCode)).toEqual([0, 128]);
  });
});
