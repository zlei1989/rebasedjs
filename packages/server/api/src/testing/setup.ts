/**
 * 测试环境初始化：提交身份经环境变量注入。
 * GIT_AUTHOR_* / GIT_COMMITTER_* 只在提交时被 git 读取，不影响 `git config` 的读写结果；
 * 值保持与 createTmpRepo 模板的 [user] 段一致，夹具中显式 `git config user.name/email`
 * 的调用因此可以删除（每省 1 次 spawn 本机实测 ~330ms）。
 */
process.env.GIT_AUTHOR_NAME = 'Test User';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = 'Test User';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';
