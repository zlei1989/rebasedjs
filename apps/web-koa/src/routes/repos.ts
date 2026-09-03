/**
 * 对称端点清单：与 web-next 的 app/api 完全一致（REST + SSE）。
 * REST：try/catch → handleApiError（ZodError → 400，ServiceError → 状态码映射）。
 * SSE：写 ctx.res（TextEncoder 字节帧）+ 监听 ctx.req close → AbortController → api opts.signal。
 */
import Router, { type RouterContext } from '@koa/router';
import { abortOperation, getLogPage, getOperation, getRepoConfig, getRepoStatus, getSettings, getFileVersions, listRecentRepos, openRepo, setRepoConfig, streamDiffEvents, streamLogEvents, updateSettings, watchRepoStatus } from '@rebased/api';
import { configPutBodySchema, diffQuerySchema, logQuerySchema, openRepoBodySchema, serializeSseEvent, settingsPatchSchema, type SseEvent } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../server-context';

/** SSE 字节帧编码器：ctx.res.write 直写原始响应，serializeSseEvent 的文本帧需编码后产出 */
const encoder = new TextEncoder();

/**
 * SSE 写出（三端点共用）：设头接管 ctx.res → req close 即 abort（取消链路）→ 迭代写字节帧。
 * 流内抛错发 stream.error 帧后结束（HTTP 状态保持 200，SSE 已建立），不崩响应——同 web-next 语义。
 */
async function writeSseStream(ctx: RouterContext, open: (signal: AbortSignal) => AsyncIterable<SseEvent>): Promise<void> {
  ctx.status = 200;
  ctx.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  ctx.respond = false; // 已接管原始响应：绕过 Koa 内建响应处理
  ctx.res.on('error', () => {}); // 半关闭连接上的残余写错误属预期噪音，吞掉防进程级未捕获
  const ac = new AbortController();
  ctx.req.on('close', () => ac.abort()); // 客户端断开 → 停写并杀 git 进程
  try {
    for await (const event of open(ac.signal)) {
      if (ctx.res.writableEnded || ctx.res.destroyed) break; // 断开后停写
      ctx.res.write(encoder.encode(serializeSseEvent(event)));
    }
  } catch (error) {
    if (!ctx.res.writableEnded && !ctx.res.destroyed) {
      ctx.res.write(encoder.encode(serializeSseEvent({ type: 'stream.error', payload: { message: (error as Error).message } })));
    }
  } finally {
    if (!ctx.res.writableEnded) ctx.res.end();
  }
}

const router = new Router();

/** GET /api/repos —— 最近仓库列表 */
router.get('/api/repos', async (ctx) => {
  try {
    ctx.body = listRecentRepos();
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/open —— zod 校验请求体 → openRepo（验证+注册）→ {repoId} */
router.post('/api/repos/open', async (ctx) => {
  try {
    const body = openRepoBodySchema.parse(ctx.request.body);
    const repo = await openRepo(body.path);
    ctx.body = { repoId: repo.id };
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/status —— repoId 解析 → getRepoStatus → 错误映射 */
router.get('/api/repos/:repoId/status', async (ctx) => {
  try {
    const status = await getRepoStatus(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
    ctx.body = status;
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/log —— zod 校验查询 → 调 api → 错误映射 */
router.get('/api/repos/:repoId/log', async (ctx) => {
  try {
    const query = logQuerySchema.parse(ctx.query);
    const page = await getLogPage(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
    ctx.body = page;
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/diff —— zod 校验查询 → getFileVersions（UX 对齐 Monaco 需要两侧全文）→ 错误映射 */
router.get('/api/repos/:repoId/diff', async (ctx) => {
  try {
    const query = diffQuerySchema.parse(ctx.query);
    const versions = await getFileVersions(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
    ctx.body = versions;
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/log/stream —— SSE：log.line 增量；断开 → AbortController → 取消 git 进程 */
router.get('/api/repos/:repoId/log/stream', async (ctx) => {
  try {
    const repoPath = resolveRepo(ctx.params.repoId);
    await writeSseStream(ctx, (signal) => streamLogEvents(repoPath, { limit: 50, skip: 0 }, { signal }));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/**
 * GET /api/repos/:repoId/diff/stream —— SSE：diff.chunk 增量；断开 → AbortController → 取消 git 进程。
 * file 校验（相对路径/绝对路径逃逸）与 from/to、staged 互斥由 api assertValidQuery 覆盖；
 * rev:'' 404 语义推迟（Ruling 2 期）：不做特判，git show :file 失败按 GIT_ERROR 走流内 error 帧。
 */
router.get('/api/repos/:repoId/diff/stream', async (ctx) => {
  try {
    const repoPath = resolveRepo(ctx.params.repoId);
    const query = diffQuerySchema.parse(ctx.query);
    await writeSseStream(ctx, (signal) => streamDiffEvents(repoPath, query, { signal }));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/**
 * GET /api/repos/:repoId/events —— SSE：repo.state-changed 状态推送（首帧为当前状态，之后变化才推）。
 * 断开 → AbortController → watchRepoStatus 轮询退出；getRepoStatus 抛错冒泡 → 流内 error 帧后结束。
 */
router.get('/api/repos/:repoId/events', async (ctx) => {
  try {
    const repoPath = resolveRepo(ctx.params.repoId);
    await writeSseStream(ctx, (signal) => watchRepoStatus(repoPath, { signal }));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/config —— repoId 解析 → getRepoConfig → 错误映射 */
router.get('/api/repos/:repoId/config', async (ctx) => {
  try {
    ctx.body = await getRepoConfig(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** PUT /api/repos/:repoId/config —— zod 校验 → setRepoConfig → 返回刷新视图 */
router.put('/api/repos/:repoId/config', async (ctx) => {
  try {
    const body = configPutBodySchema.parse(ctx.request.body);
    ctx.body = await setRepoConfig(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/operation —— 进行中操作状态 */
router.get('/api/repos/:repoId/operation', async (ctx) => {
  try {
    ctx.body = await getOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/operation/abort —— 中止当前操作 → 返回刷新状态 */
router.post('/api/repos/:repoId/operation/abort', async (ctx) => {
  try {
    ctx.body = await abortOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/settings —— 读设置 */
router.get('/api/settings', async (ctx) => {
  try {
    ctx.body = getSettings();
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** PUT /api/settings —— zod 校验补丁 → updateSettings → 返回更新后完整设置 */
router.put('/api/settings', async (ctx) => {
  try {
    const patch = settingsPatchSchema.parse(ctx.request.body);
    ctx.body = updateSettings(patch);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

export { router };
