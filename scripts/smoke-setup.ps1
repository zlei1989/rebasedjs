#!/usr/bin/env pwsh
# 冒烟仓构造/复位脚本（对应 docs/e2e-verification.md §1.3）
# 用途：一条命令重建全部冒烟仓，保证每轮 E2E 冒烟起点一致。
# 注意：会删除并重建 $Root 下的 rebased-smoke* / smoke-* 目录，勿指向真实工作区。

$ErrorActionPreference = 'Stop'
$Root = 'D:\zhanglei1120\Github'

$Main = Join-Path $Root 'rebased-smoke'
$Remote = Join-Path $Root 'smoke-remote'
$Conflict = Join-Path $Root 'rebased-smoke-conflict'
$Big = Join-Path $Root 'rebased-smoke-big'
$Shallow = Join-Path $Root 'rebased-smoke-shallow'
$SubA = Join-Path $Root 'smoke-sub'
$SubB = Join-Path $Root 'smoke-sub2'
$WorkTree = Join-Path $Root 'rebased-smoke-wt'
$NonGit = Join-Path $Root 'rebased-smoke-nongit'
$EmptyDir = Join-Path $Root 'rebased-smoke-empty'
$InitDir = Join-Path $Root 'rebased-smoke-init'
$CloneDir = Join-Path $Root 'rebased-smoke-clone'

function Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

function Invoke-Git([string]$Repo, [string[]]$GitArgs) {
  $out = & git -C $Repo @GitArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git -C $Repo $($GitArgs -join ' ') failed:`n$($out -join "`n")"
  }
  return $out
}

function Commit([string]$Repo, [string]$Message) {
  Invoke-Git $Repo @('add', '-A') | Out-Null
  Invoke-Git $Repo @('commit', '-q', '-m', $Message) | Out-Null
}

function Write-File([string]$Repo, [string]$Rel, [string]$Content) {
  $full = Join-Path $Repo $Rel
  New-Item -ItemType Directory -Force -Path (Split-Path $full -Parent) | Out-Null
  [System.IO.File]::WriteAllText($full, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function New-Repo([string]$Path) {
  if (Test-Path $Path) { Remove-Item -Recurse -Force $Path }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  Invoke-Git $Path @('init', '-q', '-b', 'master') | Out-Null
  Invoke-Git $Path @('config', 'user.name', 'Smoke Tester') | Out-Null
  Invoke-Git $Path @('config', 'user.email', 'smoke@example.com') | Out-Null
  Invoke-Git $Path @('config', 'core.autocrlf', 'false') | Out-Null
  Invoke-Git $Path @('config', 'commit.gpgsign', 'false') | Out-Null
}

function Remove-All {
  # 先摘除 worktree 注册（仅针对附属工作树；主工作树本身不能 remove），避免残留元数据
  if ((Test-Path (Join-Path $Main '.git')) -and (Test-Path $WorkTree)) {
    & git -C $Main worktree remove --force $WorkTree 2>&1 | Out-Null
  }
  foreach ($p in @($Main, $Remote, $Conflict, $Big, $Shallow, $SubA, $SubB, $WorkTree, $NonGit, $EmptyDir, $InitDir, $CloneDir)) {
    if (Test-Path $p) {
      Remove-Item -Recurse -Force $p -ErrorAction SilentlyContinue
    }
  }
}

# ---------- 0. 清理 ----------
Step 'clean previous smoke repos'
Remove-All

# ---------- 1. 子模块源仓 ----------
Step 'build submodule source repos'
New-Repo $SubA
Write-File $SubA 'index.js' "module.exports = { name: 'smoke-sub' };`n"
Commit $SubA 'feat: 子模块源首个提交'
New-Repo $SubB
Write-File $SubB 'index.js' "module.exports = { name: 'smoke-sub2' };`n"
Commit $SubB 'feat: 第二子模块源首个提交'

# ---------- 2. 裸远端 ----------
Step 'build bare remote (smoke-remote)'
New-Item -ItemType Directory -Force -Path $Remote | Out-Null
Invoke-Git $Remote @('init', '-q', '--bare', '-b', 'master') | Out-Null

# ---------- 3. 主冒烟仓 ----------
Step 'build rebased-smoke (8 commits incl. merge)'
New-Repo $Main

Write-File $Main 'README.md' "# Rebased Smoke`n`nSmoke repository for manual E2E verification.`n"
Write-File $Main 'docs/gone.md' "# gone`n`nThis file will be deleted in the working tree.`n"
Write-File $Main 'docs/old-name.md' "# old name`n`nRenamed later for --follow history test.`n"
Commit $Main 'chore: 初始化仓库与 README'

Write-File $Main 'src/app.ts' @'
/** 应用入口：负责装配服务与路由。 */
export const APP_NAME = 'rebased-smoke';

export function bootstrap(): string {
  return `boot ${APP_NAME}`;
}
'@
Write-File $Main 'src/util.ts' @'
/** 通用工具函数。 */
export function noop(): void {
  // 有意留空
}
'@
Commit $Main 'feat(core): 新增应用入口与工具函数'

$binBytes = [byte[]](0..255)
[System.IO.File]::WriteAllBytes((Join-Path (New-Item -ItemType Directory -Force -Path (Join-Path $Main 'assets')) 'logo.bin'), $binBytes)
Write-File $Main '.gitignore' "*.log`nignored-dir/`nnode_modules/`ndist/`n"
Invoke-Git $Main @('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', $SubA, 'vendor/sub-module') | Out-Null
Invoke-Git $Main @('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', $SubB, 'vendor/dir.with.dots') | Out-Null
Commit $Main 'chore: 新增忽略规则、二进制资源与本地子模块'

Invoke-Git $Main @('mv', 'docs/old-name.md', 'docs/new-name.md') | Out-Null
Commit $Main 'refactor(docs): 重命名文档为 new-name'

# feature 分支两个提交
Invoke-Git $Main @('checkout', '-q', '-b', 'feature') | Out-Null
Write-File $Main 'src/feature.ts' @'
/** feature 分支功能：第一版。 */
export function feature(): string {
  return 'feature-v1';
}
'@
Commit $Main 'feat(feature): 分支首个提交'
Write-File $Main 'src/feature.ts' @'
/** feature 分支功能：第二版。 */
export function feature(): string {
  return 'feature-v2';
}
'@
Write-File $Main 'docs/new-name.md' "# new name`n`nRenamed later for --follow history test.`n`nUpdated on feature branch.`n"
Commit $Main 'feat(feature): 分支第二个提交'

# 回 master 合并（--no-ff 造合并提交）
Invoke-Git $Main @('checkout', '-q', 'master') | Out-Null
Invoke-Git $Main @('merge', '-q', '--no-ff', '-m', "Merge branch 'feature'", 'feature') | Out-Null
Invoke-Git $Main @('tag', 'v1.0') | Out-Null

# 已合并分支（供「清理已合并分支」用例）
Invoke-Git $Main @('branch', 'merged-branch') | Out-Null

# ---------- 4. origin 推送（master/feature 推到合并提交；标签与「领先 1 提交」不推） ----------
Step 'push master/feature to origin'
Invoke-Git $Main @('remote', 'add', 'origin', $Remote) | Out-Null
Invoke-Git $Main @('push', '-q', 'origin', 'master') | Out-Null
Invoke-Git $Main @('push', '-q', 'origin', 'feature') | Out-Null
# 上游跟踪：状态条 outgoing/incoming 徽标与推送对话框依赖 upstream（缺省会退化为「无上游」不显示徽标）
Invoke-Git $Main @('branch', '--set-upstream-to=origin/master', 'master') | Out-Null
Invoke-Git $Main @('branch', '--set-upstream-to=origin/feature', 'feature') | Out-Null

# 第 8 个提交：本地领先 origin/master 1 个提交（outgoing 徽标用例）
Write-File $Main 'src/app.ts' @'
/** 应用入口：负责装配服务与路由。 */
export const APP_NAME = 'rebased-smoke';
export const APP_VERSION = '1.0.0';

export function bootstrap(): string {
  return `boot ${APP_NAME}@${APP_VERSION}`;
}
'@
Commit $Main 'fix(core): 合并后修正启动横幅'

# ---------- 5. 子模块状态：一个 deinit 成「未初始化」 ----------
Invoke-Git $Main @('submodule', 'deinit', '-q', '-f', 'vendor/dir.with.dots') | Out-Null

# ---------- 6. worktree ----------
Step 'add pre-set worktree'
Invoke-Git $Main @('worktree', 'add', '-q', $WorkTree, '-b', 'wt-branch') | Out-Null

# ---------- 7. stash x2（其一含未跟踪） ----------
Step 'seed stashes'
Write-File $Main 'README.md' "# Rebased Smoke`n`nSmoke repository for manual E2E verification.`n`nstash-1 edit`n"
Invoke-Git $Main @('stash', 'push', '-q', '-m', 'smoke-stash-1', '--', 'README.md') | Out-Null
Write-File $Main 'README.md' "# Rebased Smoke`n`nSmoke repository for manual E2E verification.`n`nstash-2 edit`n"
Write-File $Main 'stash-untracked.txt' "untracked file captured by stash -u`n"
Invoke-Git $Main @('stash', 'push', '-q', '-u', '-m', 'smoke-stash-2-untracked') | Out-Null

# ---------- 8. 工作区终态（修改/暂存/新增/删除/重命名/未跟踪/忽略/CRLF） ----------
Step 'seed working tree state'
Write-File $Main 'src/app.ts' @'
/** 应用入口：负责装配服务与路由。 */
export const APP_NAME = 'rebased-smoke';
export const APP_VERSION = '1.0.0';

export function bootstrap(): string {
  return `boot ${APP_NAME}@${APP_VERSION}`;
}

export function shutdown(): void {
  // 优雅退出：第二处 hunk，供 hunk 级暂存用例使用
  process.exitCode = 0;
}
'@
Write-File $Main 'src/util.ts' @'
/** 通用工具函数。 */
export function noop(): void {
  // 有意留空
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
'@
Invoke-Git $Main @('add', 'src/util.ts') | Out-Null
Write-File $Main 'src/new-file.ts' "export const ADDED = 'staged new file';`n"
Invoke-Git $Main @('add', 'src/new-file.ts') | Out-Null
Remove-Item -Force (Join-Path $Main 'docs/gone.md')
Invoke-Git $Main @('mv', 'src/feature.ts', 'src/feature-renamed.ts') | Out-Null
Write-File $Main 'untracked.txt' "untracked scratch file`n"
Write-File $Main 'scratch/todo.md' "# scratch`n`nuntracked directory content`n"
Write-File $Main 'ignored.log' "this file is ignored by .gitignore`n"
$crlf = "line one`r`nline two`r`nline three`r`n"
[System.IO.File]::WriteAllText((Join-Path $Main 'crlf.txt'), $crlf, (New-Object System.Text.UTF8Encoding($false)))

# ---------- 9. 冲突仓 ----------
Step 'build rebased-smoke-conflict (merge in progress)'
New-Repo $Conflict
Write-File $Conflict 'conflict.txt' "alpha`nbeta`nshared line`ngamma`ndelta`n"
Write-File $Conflict 'README.md' "# conflict repo`n"
Commit $Conflict 'chore: 初始化冲突仓'
Invoke-Git $Conflict @('checkout', '-q', '-b', 'feature') | Out-Null
Write-File $Conflict 'conflict.txt' "alpha`nbeta`nshared line changed on feature`ngamma`ndelta`n"
Write-File $Conflict 'feature-only.txt' "feature side addition`n"
Commit $Conflict 'feat: feature 分支改动同一区域'
Invoke-Git $Conflict @('checkout', '-q', 'master') | Out-Null
Write-File $Conflict 'conflict.txt' "alpha`nbeta`nshared line changed on master`ngamma`ndelta`n"
Write-File $Conflict 'master-only.txt' "master side addition`n"
Commit $Conflict 'feat: master 分支改动同一区域'
& git -C $Conflict merge feature 2>&1 | Out-Null

# ---------- 10. 大仓 ----------
Step 'build rebased-smoke-big (320 commits + big diff)'
New-Repo $Big
$bigLines = (1..40 | ForEach-Object { "big file line $_" }) -join "`n"
Write-File $Big 'big.txt' ($bigLines + "`n")
Commit $Big 'feat: 新增 big.txt 初版'
for ($i = 1; $i -le 318; $i++) {
  Invoke-Git $Big @('commit', '-q', '--allow-empty', '-m', "chore: bulk commit $i") | Out-Null
}
$bigLines2 = (1..620 | ForEach-Object { "big file line $_ - rewritten for large diff streaming" }) -join "`n"
Write-File $Big 'big.txt' ($bigLines2 + "`n")
Commit $Big 'feat: 重写 big.txt 制造大 diff'

# ---------- 11. 浅克隆仓 ----------
Step 'build rebased-smoke-shallow (depth 1)'
$remoteUrl = 'file:///' + ($Remote -replace '\\', '/')
Invoke-Git $Root @('clone', '-q', '--depth', '1', $remoteUrl, $Shallow) | Out-Null
Invoke-Git $Shallow @('config', 'user.name', 'Smoke Tester') | Out-Null
Invoke-Git $Shallow @('config', 'user.email', 'smoke@example.com') | Out-Null

# ---------- 12. 非 git / 空 / 初始化 / 克隆目标目录 ----------
Step 'build auxiliary directories'
New-Item -ItemType Directory -Force -Path $NonGit | Out-Null
Write-File $NonGit 'plain.txt' "not a git repository`n"
New-Item -ItemType Directory -Force -Path $EmptyDir | Out-Null
foreach ($p in @($InitDir, $CloneDir)) { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }

# ---------- 13. 汇总 ----------
Step 'summary'
$mainCount = (Invoke-Git $Main @('rev-list', '--count', 'HEAD') | Select-Object -First 1)
$mainBranch = (Invoke-Git $Main @('rev-parse', '--abbrev-ref', 'HEAD') | Select-Object -First 1)
$mainAhead = (Invoke-Git $Main @('rev-list', '--count', 'origin/master..master') | Select-Object -First 1)
$conflictHead = (Invoke-Git $Conflict @('status', '--porcelain=v1', '-b') | Select-Object -First 1)
$bigCount = (Invoke-Git $Big @('rev-list', '--count', 'HEAD') | Select-Object -First 1)
$summary = [ordered]@{
  main        = "$Main ($mainCount commits, branch $mainBranch, ahead origin $mainAhead)"
  remote      = $Remote
  conflict    = "$Conflict ($conflictHead)"
  big         = "$Big ($bigCount commits)"
  shallow     = "$Shallow (shallow file: $(Test-Path (Join-Path $Shallow '.git/shallow')))"
  worktree    = $WorkTree
  nongit      = $NonGit
  empty       = $EmptyDir
  initTarget  = $InitDir
  cloneTarget = $CloneDir
}
$summary.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-12} {1}" -f $_.Key, $_.Value) }
Write-Host 'smoke repos ready' -ForegroundColor Green
