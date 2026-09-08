/**
 * 对称端点清单：与 web-next 的 app/api 完全一致（REST + SSE）。
 * REST：try/catch → handleApiError（ZodError → 400，ServiceError → 状态码映射）。
 * SSE：写 ctx.res（TextEncoder 字节帧）+ 监听 ctx.req close → AbortController → api opts.signal。
 */
import Router, { type RouterContext } from '@koa/router';
import { abortOperation, addGithubPrComment, addGithubPrReviewComment, addGitlabMrComment, addGitlabMrDiscussion, addIgnore, applyBranchAction, applyChangelistAction, applyCheckout, applyHunkStaging, applyPatchService, applyRemoteAction, applyReset, applyShelfAction, applyStaging, applyStashAction, applyTagAction, checkoutGithubPr, checkoutGitlabMr, cherryPick, cloneRepo, commitAndPush, continueMergeOperation, continueOperation, createCommit, createGitlabMr, createPatch, createWorktree, deleteAccount, deletePatch, fetchRepo, getAppHomeDir, getBranches, getBrowseContent, getBrowseTree, getChangelists, getCommitFiles, getCommittedPage, getConflictContents, getConflicts, getConsole, getFileBlame, getFileDiff, getFileHistory, getFileThreeVersions, getIgnore, getIgnoreTemplates, getLogPage, getOperation, getPatches, getRebaseTodo, getRemotes, getShelves, getRepoConfig, getRepoStatus, getSettings, getFileVersions, getGithubPrDetail, getGithubPrFiles, getGithubPrReviewComments, getGithubPrs, getGithubPrTimeline, getGithubStatus, getGitlabMrDetail, getGitlabMrDiscussions, getGitlabMrFiles, getGitlabMrs, getGitlabMrTimeline, getGitlabStatus, getStashDiff, getStashes, getSubmodules, getTags, getWorktrees, importPatchIntoShelf, initRepo, listAccounts, listRecentRepos, mergeBranchIntoCurrent, mergeGithubPr, mergeGitlabMr, openRepo, pruneWorktrees, pullRepo, pushRepo, putIgnore, rebaseBranch, removeRepo, removeWorktree, resolveConflict, revert, runInteractiveRebaseService, searchCommitsService, setRepoConfig, skipOperation, streamDiffEvents, streamLogEvents, submitGithubPrReview, submitGitlabMrReview, undoCommit, unstashAs, updateProject, updateSettings, updateSubmodules, upsertAccount, watchRepoStatus } from '@rebased/api';
import { accountBodySchema, accountDeleteBodySchema, blameQuerySchema, branchActionSchema, browseContentQuerySchema, browseQuerySchema, changelistActionSchema, checkoutActionSchema, cloneRepoBodySchema, commitAndPushBodySchema, commitBodySchema, committedQuerySchema, configPutBodySchema, conflictContentsQuerySchema, consoleQuerySchema, diffQuerySchema, fetchBodySchema, githubCommentBodySchema, githubMergeBodySchema, githubPrNumberSchema, githubPrQuerySchema, githubReviewBodySchema, githubReviewCommentBodySchema, gitlabCommentBodySchema, gitlabDiscussionBodySchema, gitlabMergeBodySchema, gitlabMrCreateBodySchema, gitlabMrIidSchema, gitlabMrQuerySchema, gitlabReviewBodySchema, historyQuerySchema, hunkStagingBodySchema, ignoreAddBodySchema, ignorePutBodySchema, initRepoBodySchema, interactiveRebaseBodySchema, logQuerySchema, mergeBodySchema, openRepoBodySchema, patchApplyBodySchema, patchCreateBodySchema, patchDeleteBodySchema, patchImportShelfSchema, pickBodySchema, pullBodySchema, pushBodySchema, rebaseBodySchema, rebaseTodoQuerySchema, remoteActionSchema, resetBodySchema, resolveConflictBodySchema, searchQuerySchema, serializeSseEvent, settingsPatchSchema, shelfActionSchema, stagingBodySchema, stashActionSchema, stashIndexSchema, stashUnstashAsBodySchema, submoduleUpdateBodySchema, tagActionSchema, threeWayQuerySchema, updateBodySchema, worktreeCreateBodySchema, worktreeRemoveBodySchema, type SseEvent } from '@rebased/contracts';
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

/** POST /api/repos/init —— zod 校验请求体 → initRepo（git init + 注册）→ {repoId} */
router.post('/api/repos/init', async (ctx) => {
  try {
    const body = initRepoBodySchema.parse(ctx.request.body);
    const repo = await initRepo(body.path);
    ctx.body = { repoId: repo.id };
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/clone —— zod 校验请求体 → cloneRepo（git clone + 注册）→ {repoId}；克隆失败（网络/地址）→ GIT_ERROR */
router.post('/api/repos/clone', async (ctx) => {
  try {
    const body = cloneRepoBodySchema.parse(ctx.request.body);
    const repo = await cloneRepo(body.url, body.targetDir);
    ctx.body = { repoId: repo.id };
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** DELETE /api/repos/:repoId —— removeRepo（最近列表移除，幂等）→ {ok:true} */
router.delete('/api/repos/:repoId', async (ctx) => {
  try {
    removeRepo(z.string().min(1).parse(ctx.params.repoId));
    ctx.body = { ok: true };
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/app/home-dir —— getAppHomeDir（宿主用户主目录，路径副文本 ~/ 相对化显示用）→ {homeDir} */
router.get('/api/app/home-dir', async (ctx) => {
  try {
    ctx.body = { homeDir: getAppHomeDir() };
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

/** GET /api/repos/:repoId/diff/three-way —— zod 校验查询 → getFileThreeVersions（HEAD/暂存/工作区三侧全文）→ 200 FileThreeVersions */
router.get('/api/repos/:repoId/diff/three-way', async (ctx) => {
  try {
    const query = threeWayQuerySchema.parse(ctx.query);
    ctx.body = await getFileThreeVersions(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
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
 * GET /api/repos/:repoId/events —— SSE：仓库状态与进行中操作推送
 * （首帧依次产 repo.state-changed（当前状态）与 operation.state-changed（当前操作），之后各自变化才推）。
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

/** POST /api/repos/:repoId/operation/continue —— 继续进行中操作（按 kind 分派 merge/rebase/cherry-pick/revert；无请求体）→ 200 RepoStatus；无态 → 400 INVALID_QUERY */
router.post('/api/repos/:repoId/operation/continue', async (ctx) => {
  try {
    ctx.body = await continueOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/operation/skip —— 跳过冲突中的操作（rebase --skip / cherry-pick|revert --skip；无请求体）→ 200 RepoStatus；无态/merge → 400 INVALID_QUERY */
router.post('/api/repos/:repoId/operation/skip', async (ctx) => {
  try {
    ctx.body = await skipOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/staging —— zod 校验请求体 → applyStaging（文件级 stage/unstage/discard）→ 200 RepoStatus */
router.post('/api/repos/:repoId/staging', async (ctx) => {
  try {
    const body = stagingBodySchema.parse(ctx.request.body);
    ctx.body = await applyStaging(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/staging/hunks —— zod 校验请求体 → applyHunkStaging（hunk 级）→ 200 RepoStatus；索引越界 → 400 */
router.post('/api/repos/:repoId/staging/hunks', async (ctx) => {
  try {
    const body = hunkStagingBodySchema.parse(ctx.request.body);
    ctx.body = await applyHunkStaging(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/diff/patch —— zod 校验查询 → getFileDiff（unified patch 全文，供 hunk 级暂存索引）→ 200 DiffFile */
router.get('/api/repos/:repoId/diff/patch', async (ctx) => {
  try {
    const query = diffQuerySchema.parse(ctx.query);
    ctx.body = await getFileDiff(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/blame —— zod 校验查询 → getFileBlame（单文件逐行溯源；rev 可选指定版本）→ 200 BlameLine[]；缺 file → 400，文件不存在 → 400 INVALID_REF */
router.get('/api/repos/:repoId/blame', async (ctx) => {
  try {
    const query = blameQuerySchema.parse(ctx.query);
    ctx.body = await getFileBlame(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.file, query.rev);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/history —— zod 校验查询 → getFileHistory（--follow 跟随重命名）→ 200 FileHistoryEntry[]；缺 file → 400 */
router.get('/api/repos/:repoId/history', async (ctx) => {
  try {
    const query = historyQuerySchema.parse(ctx.query);
    ctx.body = await getFileHistory(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.file);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/browse —— zod 校验查询 → getBrowseTree（指定版本文件树）→ 200 BrowseTree；无效 rev → 400 INVALID_REF */
router.get('/api/repos/:repoId/browse', async (ctx) => {
  try {
    const query = browseQuerySchema.parse(ctx.query);
    ctx.body = await getBrowseTree(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.rev);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/browse/content —— zod 校验查询 → getBrowseContent（指定版本单文件内容 + 二进制标记）→ 200 BrowseContent */
router.get('/api/repos/:repoId/browse/content', async (ctx) => {
  try {
    const query = browseContentQuerySchema.parse(ctx.query);
    ctx.body = await getBrowseContent(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/committed —— zod 校验查询 → getCommittedPage（limit/skip 分页，hasMore 多取 1 试探）→ 200 CommittedPage */
router.get('/api/repos/:repoId/committed', async (ctx) => {
  try {
    const query = committedQuerySchema.parse(ctx.query);
    ctx.body = await getCommittedPage(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/commits/:hash —— 单提交变更文件（Show All Affected 语义 #34）→ 200 CommittedEntry；hash 无效 → 400 INVALID_REF */
router.get('/api/repos/:repoId/commits/:hash', async (ctx) => {
  try {
    const hash = z.string().min(1).parse(ctx.params.hash);
    ctx.body = await getCommitFiles(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), hash);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/search —— zod 校验查询 → searchCommitsService（grep/pickaxe 两模式）→ 200 SearchResult[]；缺 q → 400 */
router.get('/api/repos/:repoId/search', async (ctx) => {
  try {
    const query = searchQuerySchema.parse(ctx.query);
    ctx.body = await searchCommitsService(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/commit —— zod 校验请求体 → createCommit（缺 user.name/email → 400 INVALID_QUERY）→ 200 {hash} */
router.post('/api/repos/:repoId/commit', async (ctx) => {
  try {
    const body = commitBodySchema.parse(ctx.request.body);
    ctx.body = await createCommit(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/commit/push —— commit & push 组合执行器（GitCommitAndPushExecutor 语义）→ 200 CommitAndPushOutcome；错误映射 */
router.post('/api/repos/:repoId/commit/push', async (ctx) => {
  try {
    const body = commitAndPushBodySchema.parse(ctx.request.body);
    ctx.body = await commitAndPush(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/branches —— 分支列表（BranchList）→ 错误映射 */
router.get('/api/repos/:repoId/branches', async (ctx) => {
  try {
    ctx.body = await getBranches(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/branches —— zod 校验 action → applyBranchAction（create/delete/rename/setUpstream）→ 200 刷新 BranchList */
router.post('/api/repos/:repoId/branches', async (ctx) => {
  try {
    const body = branchActionSchema.parse(ctx.request.body);
    ctx.body = await applyBranchAction(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/checkout —— zod 校验 action → applyCheckout（branch/newBranch/detach）→ 200 RepoStatus */
router.post('/api/repos/:repoId/checkout', async (ctx) => {
  try {
    const body = checkoutActionSchema.parse(ctx.request.body);
    ctx.body = await applyCheckout(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/reset —— zod 校验请求体 → applyReset（soft/mixed/hard 重置到 ref）→ 200 RepoStatus；无效 ref → 400 INVALID_REF */
router.post('/api/repos/:repoId/reset', async (ctx) => {
  try {
    const body = resetBodySchema.parse(ctx.request.body);
    ctx.body = await applyReset(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/reset/undo-commit —— 撤销最近提交（soft 到 HEAD~1，无请求体）→ 200 RepoStatus；根提交/无提交 → 400 INVALID_QUERY */
router.post('/api/repos/:repoId/reset/undo-commit', async (ctx) => {
  try {
    ctx.body = await undoCommit(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/merge —— zod 校验请求体 → mergeBranchIntoCurrent（分支并入当前）→ 200 MergeOutcome；分支不存在 → 400 GIT_ERROR */
router.post('/api/repos/:repoId/merge', async (ctx) => {
  try {
    const body = mergeBodySchema.parse(ctx.request.body);
    ctx.body = await mergeBranchIntoCurrent(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/merge/continue —— 继续合并（冲突全解后产合并提交，无请求体）→ 200 RepoStatus；无进行中合并 → 400 INVALID_QUERY */
router.post('/api/repos/:repoId/merge/continue', async (ctx) => {
  try {
    ctx.body = await continueMergeOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/rebase —— zod 校验请求体 → rebaseBranch（onto 变基）→ 200 RebaseOutcome；无效 onto → 400 INVALID_REF */
router.post('/api/repos/:repoId/rebase', async (ctx) => {
  try {
    const body = rebaseBodySchema.parse(ctx.request.body);
    ctx.body = await rebaseBranch(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/rebase/todo —— zod 校验查询（base）→ getRebaseTodo（base..HEAD 全量，反序）→ 200 TodoEntry[] */
router.get('/api/repos/:repoId/rebase/todo', async (ctx) => {
  try {
    const query = rebaseTodoQuerySchema.parse(ctx.query);
    ctx.body = await getRebaseTodo(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.base);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/rebase/interactive —— zod 校验请求体 → runInteractiveRebaseService（清单全量校验后 sequence-editor 执行）→ 200 RebaseOutcome */
router.post('/api/repos/:repoId/rebase/interactive', async (ctx) => {
  try {
    const body = interactiveRebaseBodySchema.parse(ctx.request.body);
    ctx.body = await runInteractiveRebaseService(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/cherry-pick —— zod 校验请求体 → cherryPick（逐哈希预检后按序应用）→ 200 PickOutcome */
router.post('/api/repos/:repoId/cherry-pick', async (ctx) => {
  try {
    const body = pickBodySchema.parse(ctx.request.body);
    ctx.body = await cherryPick(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/revert —— zod 校验请求体 → revert（逐哈希预检后生成 Revert 提交）→ 200 PickOutcome */
router.post('/api/repos/:repoId/revert', async (ctx) => {
  try {
    const body = pickBodySchema.parse(ctx.request.body);
    ctx.body = await revert(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/conflicts —— 冲突列表（path + 存在阶段）→ 200 ConflictList；无冲突为空列表 */
router.get('/api/repos/:repoId/conflicts', async (ctx) => {
  try {
    ctx.body = await getConflicts(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/conflicts/contents —— zod 校验查询 → getConflictContents（base/ours/theirs 三版本全文）→ 200 ConflictContents */
router.get('/api/repos/:repoId/conflicts/contents', async (ctx) => {
  try {
    const query = conflictContentsQuerySchema.parse(ctx.query);
    ctx.body = await getConflictContents(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.path);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/conflicts/resolve —— zod 校验请求体 → resolveConflict（ours/theirs 整侧采纳 / manual 写入合并结果）→ 200 刷新 ConflictList；非冲突路径 → 400 INVALID_QUERY */
router.post('/api/repos/:repoId/conflicts/resolve', async (ctx) => {
  try {
    const body = resolveConflictBodySchema.parse(ctx.request.body);
    ctx.body = await resolveConflict(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/stashes —— 贮藏列表（StashList）→ 错误映射 */
router.get('/api/repos/:repoId/stashes', async (ctx) => {
  try {
    ctx.body = await getStashes(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/stashes/:index/diff —— 贮藏差异（git stash show -p）→ 200 StashDiff；索引越界 → 400 INVALID_REF */
router.get('/api/repos/:repoId/stashes/:index/diff', async (ctx) => {
  try {
    const { index } = stashIndexSchema.parse({ index: ctx.params.index });
    ctx.body = await getStashDiff(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), index);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/stashes/unstash-as —— Unstash As（检出目标分支 + apply，不 drop）→ 200 StashList */
router.post('/api/repos/:repoId/stashes/unstash-as', async (ctx) => {
  try {
    const body = stashUnstashAsBodySchema.parse(ctx.request.body);
    ctx.body = await unstashAs(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/stashes —— zod 校验 action → applyStashAction（save/apply/pop/drop/branch）→ 200 刷新 StashList；无改动 save → 400 INVALID_QUERY，越界 index → 400 INVALID_REF */
router.post('/api/repos/:repoId/stashes', async (ctx) => {
  try {
    const body = stashActionSchema.parse(ctx.request.body);
    ctx.body = await applyStashAction(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/changelists —— 变更列表视图（ChangelistView：lists + assignments）→ 错误映射 */
router.get('/api/repos/:repoId/changelists', async (ctx) => {
  try {
    ctx.body = await getChangelists(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/changelists —— zod 校验 action → applyChangelistAction（create/rename/delete/setDefault/move）→ 200 刷新 ChangelistView；列表不存在/重名/删默认 → 400 INVALID_QUERY */
router.post('/api/repos/:repoId/changelists', async (ctx) => {
  try {
    const body = changelistActionSchema.parse(ctx.request.body);
    ctx.body = await applyChangelistAction(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/remotes —— 远程列表（RemoteList）→ 错误映射 */
router.get('/api/repos/:repoId/remotes', async (ctx) => {
  try {
    ctx.body = await getRemotes(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/remotes —— zod 校验 action → applyRemoteAction（add/remove/setUrl）→ 200 刷新 RemoteList；add 重名 → 400 INVALID_QUERY，remove/setUrl 不存在 → 400 INVALID_REF */
router.post('/api/repos/:repoId/remotes', async (ctx) => {
  try {
    const body = remoteActionSchema.parse(ctx.request.body);
    ctx.body = await applyRemoteAction(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/fetch —— zod 校验请求体（可空 {}）→ fetchRepo → 200 FetchResult；认证失败 → 401 AUTH_FAILED（context.host 供对话框预填） */
router.post('/api/repos/:repoId/fetch', async (ctx) => {
  try {
    const body = fetchBodySchema.parse(ctx.request.body);
    ctx.body = await fetchRepo(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/pull —— zod 校验请求体 → pullRepo（remote?/rebase?）→ 200 PullOutcome；认证失败 → 401 AUTH_FAILED */
router.post('/api/repos/:repoId/pull', async (ctx) => {
  try {
    const body = pullBodySchema.parse(ctx.request.body);
    ctx.body = await pullRepo(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/**
 * POST /api/repos/:repoId/push —— zod 校验请求体 → pushRepo → 200 PushOutcome。
 * rejected（non-fast-forward）是 200 业务结果（附中文 hint），路由层无 409 特判；认证失败 → 401 AUTH_FAILED。
 */
router.post('/api/repos/:repoId/push', async (ctx) => {
  try {
    const body = pushBodySchema.parse(ctx.request.body);
    ctx.body = await pushRepo(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/update —— zod 校验请求体（strategy: merge|rebase）→ updateProject（fetch 全远程 + 策略化 pull）→ 200 UpdateOutcome */
router.post('/api/repos/:repoId/update', async (ctx) => {
  try {
    const body = updateBodySchema.parse(ctx.request.body);
    ctx.body = await updateProject(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/tags —— 标签列表（TagList）→ 错误映射 */
router.get('/api/repos/:repoId/tags', async (ctx) => {
  try {
    ctx.body = await getTags(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/tags —— zod 校验 action → applyTagAction（create/delete/push）→ 200 刷新 TagList；重名 → 400 INVALID_QUERY，不存在 → 400 INVALID_REF */
router.post('/api/repos/:repoId/tags', async (ctx) => {
  try {
    const body = tagActionSchema.parse(ctx.request.body);
    ctx.body = await applyTagAction(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
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

/** GET /api/auth/accounts —— 账户列表（掩码视图）。应用级，无 repoId */
router.get('/api/auth/accounts', async (ctx) => {
  try {
    ctx.body = listAccounts();
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/auth/accounts —— zod 校验 → upsertAccount（添加/覆盖）→ 返回刷新掩码视图 */
router.post('/api/auth/accounts', async (ctx) => {
  try {
    const body = accountBodySchema.parse(ctx.request.body);
    ctx.body = upsertAccount(body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/auth/accounts/delete —— zod 校验 → deleteAccount → 返回刷新掩码视图；账户不存在 → 400 INVALID_QUERY */
router.post('/api/auth/accounts/delete', async (ctx) => {
  try {
    const body = accountDeleteBodySchema.parse(ctx.request.body);
    ctx.body = deleteAccount(body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/patches —— 补丁列表（PatchList）→ 错误映射 */
router.get('/api/repos/:repoId/patches', async (ctx) => {
  try {
    ctx.body = await getPatches(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/patches/create —— zod 校验请求体 → createPatch（工作区/from/to/staged 数据源）→ 200 刷新 PatchList */
router.post('/api/repos/:repoId/patches/create', async (ctx) => {
  try {
    const body = patchCreateBodySchema.parse(ctx.request.body);
    ctx.body = await createPatch(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/patches/apply —— zod 校验请求体 → applyPatchService（check+apply 两段）→ 200 RepoStatus；补丁不存在 → 400 INVALID_REF，失败映射 INVALID_QUERY */
router.post('/api/repos/:repoId/patches/apply', async (ctx) => {
  try {
    const body = patchApplyBodySchema.parse(ctx.request.body);
    ctx.body = await applyPatchService(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/patches/:name/import-shelf —— 导入补丁为搁置（ImportIntoShelfAction）→ 200 ShelfList；重名 → 400 INVALID_QUERY、补丁不存在 → 400 INVALID_REF */
router.post('/api/repos/:repoId/patches/:name/import-shelf', async (ctx) => {
  try {
    const { name } = patchImportShelfSchema.parse({ name: ctx.params.name });
    ctx.body = await importPatchIntoShelf(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), name);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/patches/delete —— zod 校验请求体 → deletePatch → 200 刷新 PatchList；补丁不存在 → 400 INVALID_REF */
router.post('/api/repos/:repoId/patches/delete', async (ctx) => {
  try {
    const body = patchDeleteBodySchema.parse(ctx.request.body);
    ctx.body = await deletePatch(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/shelves —— 搁置列表（ShelfList）→ 错误映射 */
router.get('/api/repos/:repoId/shelves', async (ctx) => {
  try {
    ctx.body = await getShelves(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/shelves —— zod 校验 action（save/restore/drop 判别联合）→ applyShelfAction → 200 刷新 ShelfList；save 重名 → 400 INVALID_QUERY，restore/drop 不存在 → 400 INVALID_REF */
router.post('/api/repos/:repoId/shelves', async (ctx) => {
  try {
    const body = shelfActionSchema.parse(ctx.request.body);
    ctx.body = await applyShelfAction(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/console —— zod 校验查询（limit 默认 100，coerce 数字）→ getConsole → 200 ConsoleEntry[]（旧→新，id 从 1 递增） */
router.get('/api/repos/:repoId/console', async (ctx) => {
  try {
    const query = consoleQuerySchema.parse(ctx.query);
    ctx.body = await getConsole(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.limit);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/ignore —— 忽略配置读（.gitignore 与 .git/info/exclude）→ 错误映射 */
router.get('/api/repos/:repoId/ignore', async (ctx) => {
  try {
    ctx.body = await getIgnore(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** PUT /api/repos/:repoId/ignore —— zod 校验请求体 → putIgnore（整写目标文件，exclude 先建 .git/info/）→ 200 刷新视图 */
router.put('/api/repos/:repoId/ignore', async (ctx) => {
  try {
    const body = ignorePutBodySchema.parse(ctx.request.body);
    ctx.body = await putIgnore(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/ignore/add —— zod 校验请求体（契约仅 {path}）→ addIgnore（固定追加到 .gitignore）→ 200 刷新视图 */
router.post('/api/repos/:repoId/ignore/add', async (ctx) => {
  try {
    const body = ignoreAddBodySchema.parse(ctx.request.body);
    ctx.body = await addIgnore(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/ignore/templates —— 内建忽略模板（无参 GET，服务不触盘）；repoId 仍校验（与其余 repo 域端点一致：未注册 → 404 REPO_NOT_FOUND） */
router.get('/api/repos/:repoId/ignore/templates', async (ctx) => {
  try {
    resolveRepo(z.string().min(1).parse(ctx.params.repoId));
    ctx.body = getIgnoreTemplates();
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/github/status —— GitHub 域可用性三态（服务层不抛错）→ 200 GitHubStatus；未注册 repo → 404 */
router.get('/api/repos/:repoId/github/status', async (ctx) => {
  try {
    ctx.body = await getGithubStatus(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/github/prs —— zod 校验查询（state 缺省 open）→ getGithubPrs → 200 GitHubPrList；state 非法 → 400 */
router.get('/api/repos/:repoId/github/prs', async (ctx) => {
  try {
    const query = githubPrQuerySchema.parse(ctx.query);
    ctx.body = await getGithubPrs(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.state);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/github/prs/:number —— githubPrNumberSchema 校验路径参数 → getGithubPrDetail → 200 GitHubPrDetail；number 非法 → 400 */
router.get('/api/repos/:repoId/github/prs/:number', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    ctx.body = await getGithubPrDetail(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/github/prs/:number/timeline —— 路径参数校验 → getGithubPrTimeline（comments+reviews 合并升序）→ 200 GitHubTimeline */
router.get('/api/repos/:repoId/github/prs/:number/timeline', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    ctx.body = await getGithubPrTimeline(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/github/prs/:number/comments —— zod 校验请求体 → addGithubPrComment → 200 刷新 GitHubTimeline；body 空/超长 → 400 */
router.post('/api/repos/:repoId/github/prs/:number/comments', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    const body = githubCommentBodySchema.parse(ctx.request.body);
    ctx.body = await addGithubPrComment(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number, body.body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET/POST /api/repos/:repoId/github/prs/:number/review-comments —— 行级评审评论列表与添加（POST {path,line,side,body}→刷新列表） */
router.get('/api/repos/:repoId/github/prs/:number/review-comments', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    ctx.body = await getGithubPrReviewComments(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number);
  } catch (error) {
    handleApiError(error, ctx);
  }
});
router.post('/api/repos/:repoId/github/prs/:number/review-comments', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    const body = githubReviewCommentBodySchema.parse(ctx.request.body);
    ctx.body = await addGithubPrReviewComment(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number, body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/github/prs/:number/files —— 路径参数校验 → getGithubPrFiles → 200 GitHubPrFiles（patch 缺省 → ''） */
router.get('/api/repos/:repoId/github/prs/:number/files', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    ctx.body = await getGithubPrFiles(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/github/prs/:number/review —— zod 校验请求体 → submitGithubPrReview → 200 刷新 GitHubPrDetail；event 非法 → 400 */
router.post('/api/repos/:repoId/github/prs/:number/review', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    const body = githubReviewBodySchema.parse(ctx.request.body);
    ctx.body = await submitGithubPrReview(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number, body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/github/prs/:number/merge —— zod 校验请求体 → mergeGithubPr → 200 GitHubPrMergeResult；method 非法 → 400 */
router.post('/api/repos/:repoId/github/prs/:number/merge', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    const body = githubMergeBodySchema.parse(ctx.request.body);
    ctx.body = await mergeGithubPr(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number, body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/github/prs/:number/checkout —— 路径参数校验（无请求体）→ checkoutGithubPr → 200 {branchName:'pr-N'}；无远程 → 400 */
router.post('/api/repos/:repoId/github/prs/:number/checkout', async (ctx) => {
  try {
    const { number } = githubPrNumberSchema.parse({ number: ctx.params.number });
    ctx.body = await checkoutGithubPr(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), number);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/gitlab/status —— GitLab 域可用性三态（服务层不抛错）→ 200 GitLabStatus；未注册 repo → 404 */
router.get('/api/repos/:repoId/gitlab/status', async (ctx) => {
  try {
    ctx.body = await getGitlabStatus(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/gitlab/mrs —— zod 校验查询（state 缺省 opened）→ getGitlabMrs → 200 GitLabMrList；state 非法 → 400 */
router.get('/api/repos/:repoId/gitlab/mrs', async (ctx) => {
  try {
    const query = gitlabMrQuerySchema.parse(ctx.query);
    ctx.body = await getGitlabMrs(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), query.state);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/gitlab/mrs —— zod 校验请求体 → createGitlabMr → 200 重查 GitLabMrDetail；body 缺字段 → 400 */
router.post('/api/repos/:repoId/gitlab/mrs', async (ctx) => {
  try {
    const body = gitlabMrCreateBodySchema.parse(ctx.request.body);
    ctx.body = await createGitlabMr(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/gitlab/mrs/:iid —— gitlabMrIidSchema 校验路径参数 → getGitlabMrDetail → 200 GitLabMrDetail；iid 非法 → 400 */
router.get('/api/repos/:repoId/gitlab/mrs/:iid', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    ctx.body = await getGitlabMrDetail(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/gitlab/mrs/:iid/timeline —— 路径参数校验 → getGitlabMrTimeline（notes+reviews 合并升序）→ 200 GitLabTimeline */
router.get('/api/repos/:repoId/gitlab/mrs/:iid/timeline', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    ctx.body = await getGitlabMrTimeline(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/gitlab/mrs/:iid/comments —— zod 校验请求体 → addGitlabMrComment → 200 刷新 GitLabTimeline；body 空/超长 → 400 */
router.post('/api/repos/:repoId/gitlab/mrs/:iid/comments', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    const body = gitlabCommentBodySchema.parse(ctx.request.body);
    ctx.body = await addGitlabMrComment(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid, body.body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET/POST /api/repos/:repoId/gitlab/mrs/:iid/discussions —— 行级讨论注记列表（展平 notes）与添加（POST {body,position{new_path,new_line}}→刷新列表） */
router.get('/api/repos/:repoId/gitlab/mrs/:iid/discussions', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    ctx.body = await getGitlabMrDiscussions(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid);
  } catch (error) {
    handleApiError(error, ctx);
  }
});
router.post('/api/repos/:repoId/gitlab/mrs/:iid/discussions', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    const body = gitlabDiscussionBodySchema.parse(ctx.request.body);
    ctx.body = await addGitlabMrDiscussion(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid, body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/gitlab/mrs/:iid/files —— 路径参数校验 → getGitlabMrFiles → 200 GitLabMrFiles（diff 缺省 → ''） */
router.get('/api/repos/:repoId/gitlab/mrs/:iid/files', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    ctx.body = await getGitlabMrFiles(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/gitlab/mrs/:iid/review —— zod 校验请求体 → submitGitlabMrReview → 200 刷新 GitLabMrDetail；event 非法 → 400 */
router.post('/api/repos/:repoId/gitlab/mrs/:iid/review', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    const body = gitlabReviewBodySchema.parse(ctx.request.body);
    ctx.body = await submitGitlabMrReview(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid, body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/gitlab/mrs/:iid/merge —— zod 校验请求体 → mergeGitlabMr → 200 GitLabMrMergeResult；squash 类型非法 → 400 */
router.post('/api/repos/:repoId/gitlab/mrs/:iid/merge', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    const body = gitlabMergeBodySchema.parse(ctx.request.body);
    ctx.body = await mergeGitlabMr(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid, body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/gitlab/mrs/:iid/checkout —— 路径参数校验（无请求体）→ checkoutGitlabMr → 200 {branchName:'mr-N'}；无远程 → 400 */
router.post('/api/repos/:repoId/gitlab/mrs/:iid/checkout', async (ctx) => {
  try {
    const { iid } = gitlabMrIidSchema.parse({ iid: ctx.params.iid });
    ctx.body = await checkoutGitlabMr(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), iid);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/worktrees —— 列表（主 + 副工作树）→ 200 WorktreeList；未注册 repo → 404 */
router.get('/api/repos/:repoId/worktrees', async (ctx) => {
  try {
    ctx.body = await getWorktrees(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/worktrees —— zod 校验请求体 → createWorktree → 200 刷新 WorktreeList；互斥/分支不存在/路径无效 → 400 */
router.post('/api/repos/:repoId/worktrees', async (ctx) => {
  try {
    const body = worktreeCreateBodySchema.parse(ctx.request.body);
    ctx.body = await createWorktree(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/worktrees/remove —— zod 校验请求体 → removeWorktree → 200 刷新 WorktreeList；path 空/不在列表 → 400 */
router.post('/api/repos/:repoId/worktrees/remove', async (ctx) => {
  try {
    const body = worktreeRemoveBodySchema.parse(ctx.request.body);
    ctx.body = await removeWorktree(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/worktrees/prune —— 无请求体 → pruneWorktrees → 200 刷新 WorktreeList */
router.post('/api/repos/:repoId/worktrees/prune', async (ctx) => {
  try {
    ctx.body = await pruneWorktrees(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/submodules —— 列表 → 200 SubmoduleList；损坏 .gitmodules → 500 GIT_ERROR */
router.get('/api/repos/:repoId/submodules', async (ctx) => {
  try {
    ctx.body = await getSubmodules(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/submodules/update —— zod 校验请求体 → updateSubmodules → 200 刷新 SubmoduleList；name 空 → 400 */
router.post('/api/repos/:repoId/submodules/update', async (ctx) => {
  try {
    const body = submoduleUpdateBodySchema.parse(ctx.request.body);
    ctx.body = await updateSubmodules(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

export { router };
