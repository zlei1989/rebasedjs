# Rebased.js 功能验证报告（E2E 浏览器实测）

- **日期**：2026-09-02
- **范围**：Plan 1/2a/2b 组装后的 P1 功能面（打开仓库、提交图、提交详情、单文件 diff、状态条、SSE 实时更新）
- **基准**：功能对齐 Java 版 Rebased（`D:\zhanglei1120\Github\rebased`）
- **测试仓库**：`D:\zhanglei1120\Github\test`（含分支合并的 8 提交历史 + 未提交修改）
- **方式**：Playwright 真实浏览器操作（模拟点击/输入/缩放窗口）
- **应用**：web-next（http://localhost:3030）、web-koa（http://localhost:3031 API + 5173 SPA）

## 一、功能点验证矩阵

| # | 功能点 | Java 对齐依据 | 验证方式 | 结果 | 截图 |
|---|--------|---------------|----------|------|------|
| 1 | 打开仓库 + 最近列表 | RecentProjectsManager（最近优先/去重） | 输入路径 → 打开 → 跳转日志页 | ✅ | logpage-1.png |
| 2 | 打开失败反馈（toast） | GitHttpLoginDialog 等错误提示语义 | 坏路径 → 打开 → "不是 git 仓库：…" toast | ✅ | — |
| 3 | 提交图（lanes/edges/合并结构） | vcs-log/graph 布局算法（已移植） | 渲染 8 提交含合并 → 图列正确岔开/合拢 | ✅ | logpage-1.png、large.png |
| 4 | 提交详情面板（hash+复制/作者/日期/subject/chips/父链接） | CommitDetailsPanel.kt 字段集 | 点击合并提交行 → 右侧详情面板完整 | ✅ | narrow-details-fixed2.png、large.png |
| 5 | 单文件 diff（并排/行内/工作区/已暂存/忽略空白） | DiffManagerImpl 默认并排 + 忽略空白开关 | 切并排/行内/已暂存/忽略空白逐项 | ✅ | diff-dark.png、diff-inline.png、diff-staged.png |
| 6 | Monaco 暗色主题（与应用一致） | 平台 LAF | 编辑器 vs-dark 与暗色应用一致 | ✅ | diff-dark.png |
| 7 | 状态条（分支 + ahead/behind 徽标） | GitBranchWidget（2025 版圆点徽标，无 ↑↓ 文本） | 分支名显示；无远端时徽标不显示（正确） | ✅ | logpage-1.png |
| 8 | SSE 实时更新（提交后日志自动刷新） | GitRepositoryUpdater 事件驱动刷新 | 浏览器开着日志页 → 另开终端提交 → 新提交自动出现在顶部（无需刷新） | ✅ | live-update.png |
| 9 | SSE 断开零进程残留 | — | 断开后 git 进程无残留（实测） | ✅ | — |
| 10 | 窄窗自适应（600×400，详情面板开） | — | subject 截断显示 + 作者/日期可见，详情面板独立 | ✅ | narrow-details-fixed2.png |
| 11 | 大窗自适应（1600×900） | — | 图左 + 作者/日期中 + 详情右，布局正常 | ✅ | large.png |
| 12 | web-koa 与 web-next 视觉/功能对等 | — | 5173 与 3030 日志页与 diff 页一致 | ✅ | koa-log-dark.png、koa-diff-fixed.png |
| 13 | 质量门（typecheck/format/test） | — | `pnpm typecheck` → `format` → `test`（串行）全绿，190+ 用例 | ✅ | — |

## 二、本轮 E2E 发现并修复的缺陷

| 缺陷 | 根因 | 修复 | 验证 |
|------|------|------|------|
| **干净提交不触发实时刷新** | status 深比较不含 HEAD——干净提交的 branch/ahead/behind/entries 全不变 → events 不发 → log 不刷新 | status 加 `headHash`（core 解析 `# branch.oid` + contracts + api + 测试），容器事件回调同时重验证日志快照 + 重订阅流（refreshKey） | 浏览器实测：开着页面提交 → 新行自动出现在顶部（live-update.png） |
| **Monaco diff 编辑器高度塌成 5px** | antd `App` 包装层无高度，html/body 的 `height:100%` 断在 `.ant-app`（web-next）与 `#root`（web-koa/Vite）处 | globals.css 补 `.ant-app { height:100% }`；web-koa index.css 补 `#root { height:100% }` + 同源暗色底 | 编辑器满高渲染（diff-fixed.png、koa-diff-fixed.png） |
| **Monaco 亮主题与暗色应用违和** | monaco-lazy 未设主题 | createDiffEditor 加 `theme: 'vs-dark'` | diff-dark.png |
| **窄窗下 subject 列被挤成 0 宽** | flex 项缺 `min-width:0`/subject 无最小宽，author+date 占满整行 | subject `minWidth:80` + author/date `flexShrink:1,minWidth:0,ellipsis` | narrow-details-fixed2.png |
| **git clone 在测试环境偶发挂起** | Git for Windows msys2 运行时并发初始化缺陷（`sh.exe: add_item failed`），clone 的 transport helper 挂死 | runGit 补 `timeoutMs`（超时杀进程 + 退出码 124）、cloneGitRepo 30s 超时、clone 测试 `{ timeout: 90000, retry: 2 }`、根 test 改串行 | 全量测试串行全绿 |
| **测试夹具中文乱码** | pwsh Set-Content 默认 GBK 写文件，应用按 UTF-8 读 | 夹具改用 UTF-8 无 BOM 写入（重建测试仓库历史） | diff 中文正常显示 |

## 三、已知限制与后续项（推迟，非缺陷）

- 剪贴板验证：复制按钮已接线（navigator.clipboard.writeText），测试浏览器读剪贴板需权限——仅作提示。
- Monaco worker 未配置（MonacoEnvironment.getWorker）——dev 下回退主线程 + console 警告，功能正常；worker 接线属 apps 层后续。
- web-koa SPA 深链接直开 404（koa-static 无 history fallback）——应用内跳转与 Vite dev 正常；fallback 中间件留后续。
- 显示名三级回退缺 `.idea/.name` 级（plan 裁定简化为注册名/目录名）——Ruling 8 登记。
- stream.error 的 `useRepoEvents` 断流仍静默（client 包范围外，Task 7 终审 deferred）。
- 长边（跨度 >2 中间行）在图行切片处视觉中断——图渲染打磨项，后续完善。
- P2–P4 功能（暂存区/commit/分支管理/rebase/远程/GitHub/GitLab 等）按计划排期，不在本轮范围。

## 四、结论

在已实现的 P1 功能面上，**全部功能点经真实浏览器操作验证正确可用，与 Java 版 Rebased 对齐**；6 项 E2E 发现的缺陷全部修复并有对应测试或截图证据。两个下游应用（Next.js 与 Koa）均可独立运行且行为对等。
