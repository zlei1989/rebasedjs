/**
 * vitest setupFiles（每个测试文件进程启动时执行一次）：
 * 统一 git 提交身份——夹具（registerRepo/makeLocalCommit/pushRemoteCommit 等）产出的提交
 * 作者/邮箱固定为 Test User <test@example.com>，log/blame/committed 等断言的 author 依赖于此。
 * GIT_AUTHOR_*、GIT_COMMITTER_* 环境变量优先于 user.name/user.email 配置（git commit 身份解析语义）。
 */
process.env.GIT_AUTHOR_NAME = 'Test User';
process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
process.env.GIT_COMMITTER_NAME = 'Test User';
process.env.GIT_COMMITTER_EMAIL = 'test@example.com';
