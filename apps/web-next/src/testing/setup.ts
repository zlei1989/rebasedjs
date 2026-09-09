/**
 * vitest setupFiles（每个 worker 启动时执行一次）：注入 git 提交身份环境变量。
 * 环境变量优先级高于 git config，拆分后的路由测试夹具（routes-helpers.ts）因此不再
 * 写 git config user.*（省 2 次 spawn/仓库）；需要断言仓库本地 config 的用例
 * 由所在测试文件做文件级隔离补设。
 */
process.env.GIT_AUTHOR_NAME = 'Test User';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = 'Test User';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';
