import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  blameQuerySchema,
  branchActionSchema,
  checkoutActionSchema,
  checkoutRebaseBodySchema,
  checkoutUpdateBodySchema,
  gpgConfigBodySchema,
  commitBodySchema,
  amendSpecificBodySchema,
  autosquashBodySchema,
  commitEditBodySchema,
  commitAndPushBodySchema,
  committedQuerySchema,
  configPutBodySchema,
  diffQuerySchema,
  historyQuerySchema,
  hunkStagingBodySchema,
  logQuerySchema,
  openRepoBodySchema,
  conflictContentsQuerySchema,
  mergeBodySchema,
  resetBodySchema,
  resolveConflictBodySchema,
  settingsPatchSchema,
  stagingBodySchema,
  stashActionSchema,
  changelistActionSchema,
  accountBodySchema,
  accountDeleteBodySchema,
  remoteActionSchema,
  fetchBodySchema,
  pullBodySchema,
  pushBodySchema,
  updateBodySchema,
  rebaseBodySchema,
  rebaseTodoQuerySchema,
  searchQuerySchema,
  interactiveRebaseBodySchema,
  pickBodySchema,
  tagActionSchema,
  patchCreateBodySchema,
  patchApplyBodySchema,
  patchDeleteBodySchema,
  shelfActionSchema,
  consoleQuerySchema,
  ignorePutBodySchema,
  ignoreAddBodySchema,
  githubPrQuerySchema,
  githubPrNumberSchema,
  githubCommentBodySchema,
  githubReviewBodySchema,
  githubMergeBodySchema,
  gitlabMrQuerySchema,
  gitlabMrIidSchema,
  gitlabMrCreateBodySchema,
  gitlabCommentBodySchema,
  gitlabReviewBodySchema,
  gitlabMergeBodySchema,
  worktreeCreateBodySchema,
  worktreeRemoveBodySchema,
  submoduleUpdateBodySchema,
} from './endpoints';
import type {
  GitHubPrDetail,
  GitHubPrSummary,
  GitHubRepoRef,
  GitHubStatus,
  GitHubTimelineEntry,
  GitLabMrDetail,
  GitLabMrSummary,
  GitLabRepoRef,
  GitLabStatus,
  GitLabTimelineEntry,
  WorktreeEntry,
  WorktreeList,
  SubmoduleEntry,
  SubmoduleList,
} from './domain';

describe('P1 端点 schema', () => {
  it('logQuery 默认 limit=50，接受 author/path/skip', () => {
    expect(logQuerySchema.parse({}).limit).toBe(50);
    expect(logQuerySchema.parse({ limit: 10, skip: 20, author: '张三' }))
      .toEqual({ limit: 10, skip: 20, author: '张三' });
  });

  it('openRepoBody 要求非空 path', () => {
    expect(() => openRepoBodySchema.parse({ path: '' })).toThrow();
  });

  it('diffQuery 默认 unstaged，支持 from/to', () => {
    expect(diffQuerySchema.parse({ file: 'a.txt' })).toEqual({ file: 'a.txt', staged: false });
    expect(diffQuerySchema.parse({ file: 'a.txt', from: 'HEAD~1', to: 'HEAD', staged: true }).staged).toBe(true);
  });

  it('diffQuery staged 查询串：' + '\'false\' → false、\'true\' → true（coerce.boolean 会把 \'false\' 当真）', () => {
    expect(diffQuerySchema.parse({ file: 'a.txt', staged: 'false' }).staged).toBe(false);
    expect(diffQuerySchema.parse({ file: 'a.txt', staged: 'true' }).staged).toBe(true);
    expect(() => diffQuerySchema.parse({ file: 'a.txt', staged: 'yes' })).toThrow();
  });

  it('settingsPatch 校验 logInEditor 布尔与 recentRepoIds 数组', () => {
    expect(() => settingsPatchSchema.parse({ logInEditor: 'yes' })).toThrow();
    expect(settingsPatchSchema.parse({ recentRepoIds: ['a', 'b'] })).toEqual({ recentRepoIds: ['a', 'b'] });
    // 保护分支模式列表（正则语法由服务端校验；schema 只约束形状）
    expect(settingsPatchSchema.parse({ protectedBranchPatterns: ['^main$', '^release/'] }))
      .toEqual({ protectedBranchPatterns: ['^main$', '^release/'] });
    expect(() => settingsPatchSchema.parse({ protectedBranchPatterns: '^main$' })).toThrow();
  });
});

describe('configPutBodySchema', () => {
  it('接受白名单键与字符串值', () => {
    const body = configPutBodySchema.parse({ key: 'user.name', value: '张三' });
    expect(body).toEqual({ key: 'user.name', value: '张三' });
    expect(configPutBodySchema.parse({ key: 'commit.template', value: '/tpl.txt' })).toEqual({ key: 'commit.template', value: '/tpl.txt' });
  });
  it('拒绝白名单外的键与空值', () => {
    expect(() => configPutBodySchema.parse({ key: 'core.hooksPath', value: '/x' })).toThrow();
    expect(() => configPutBodySchema.parse({ key: 'user.name', value: '' })).toThrow();
  });
});

describe('stagingBodySchema（暂存区文件级操作）', () => {
  it('接受 stage/unstage/discard 与非空路径数组', () => {
    expect(stagingBodySchema.parse({ action: 'stage', paths: ['a.txt'] }))
      .toEqual({ action: 'stage', paths: ['a.txt'] });
    expect(stagingBodySchema.parse({ action: 'discard', paths: ['a.txt', 'b/c.txt'] }).action).toBe('discard');
  });
  it('拒绝空 paths 数组与枚举外 action', () => {
    expect(() => stagingBodySchema.parse({ action: 'stage', paths: [] })).toThrow();
    expect(() => stagingBodySchema.parse({ action: 'reset', paths: ['a.txt'] })).toThrow();
  });
});

describe('hunkStagingBodySchema（hunk 级操作）', () => {
  it('接受 file 与 0-based hunk 索引数组', () => {
    expect(hunkStagingBodySchema.parse({ action: 'unstage', file: 'a.txt', hunks: [0, 2] }))
      .toEqual({ action: 'unstage', file: 'a.txt', hunks: [0, 2] });
  });
  it('拒绝负索引、空 hunks 数组与空 file', () => {
    expect(() => hunkStagingBodySchema.parse({ action: 'stage', file: 'a.txt', hunks: [0, -1] })).toThrow();
    expect(() => hunkStagingBodySchema.parse({ action: 'stage', file: 'a.txt', hunks: [] })).toThrow();
    expect(() => hunkStagingBodySchema.parse({ action: 'stage', file: '', hunks: [0] })).toThrow();
  });
});

describe('commitBodySchema（提交请求体）', () => {
  it('message 必填，amend/signOff/noVerify/crlfFix 可选布尔', () => {
    expect(commitBodySchema.parse({ message: '修复：暂存逻辑' })).toEqual({ message: '修复：暂存逻辑' });
    expect(commitBodySchema.parse({ message: 'x', amend: true, signOff: true, noVerify: true }))
      .toEqual({ message: 'x', amend: true, signOff: true, noVerify: true });
    expect(commitBodySchema.parse({ message: 'x', crlfFix: true })).toEqual({ message: 'x', crlfFix: true });
  });
  it('拒绝空 message 与非布尔 amend', () => {
    expect(() => commitBodySchema.parse({ message: '' })).toThrow();
    expect(() => commitBodySchema.parse({})).toThrow();
    expect(() => commitBodySchema.parse({ message: 'x', amend: 'yes' })).toThrow();
    expect(() => commitBodySchema.parse({ message: 'x', crlfFix: 'yes' })).toThrow();
  });
});

describe('amendSpecificBodySchema（amend 指定历史提交）', () => {
  it('targetHash + message 齐备 → 原样解析', () => {
    expect(amendSpecificBodySchema.parse({ targetHash: 'aaaaaa', message: '重写提交信息' }))
      .toEqual({ targetHash: 'aaaaaa', message: '重写提交信息' });
  });
  it('targetHash/message 空串或缺失 → 抛错', () => {
    expect(() => amendSpecificBodySchema.parse({ targetHash: '', message: 'x' })).toThrow();
    expect(() => amendSpecificBodySchema.parse({ targetHash: 'aaaaaa', message: '' })).toThrow();
    expect(() => amendSpecificBodySchema.parse({ targetHash: 'aaaaaa' })).toThrow();
  });
});

describe('autosquashBodySchema（auto-squash：fixup!/squash! 提交折入）', () => {
  it('hash + action 齐备 → 原样解析（action 枚举 fixup/squash）', () => {
    expect(autosquashBodySchema.parse({ hash: 'aaaaaa', action: 'fixup' })).toEqual({ hash: 'aaaaaa', action: 'fixup' });
    expect(autosquashBodySchema.parse({ hash: 'aaaaaa', action: 'squash' })).toEqual({ hash: 'aaaaaa', action: 'squash' });
  });
  it('hash 空串/缺失或 action 非法 → 抛错', () => {
    expect(() => autosquashBodySchema.parse({ hash: '', action: 'fixup' })).toThrow();
    expect(() => autosquashBodySchema.parse({ hash: 'aaaaaa' })).toThrow();
    expect(() => autosquashBodySchema.parse({ hash: 'aaaaaa', action: 'reword' })).toThrow();
  });
});

describe('commitEditBodySchema（单提交编辑直通）', () => {
  it('hash + action 齐备 → 原样解析（reword 可带 message；其余缺省）', () => {
    expect(commitEditBodySchema.parse({ hash: 'aaaaaa', action: 'reword', message: '新信息' }))
      .toEqual({ hash: 'aaaaaa', action: 'reword', message: '新信息' });
    expect(commitEditBodySchema.parse({ hash: 'aaaaaa', action: 'drop' })).toEqual({ hash: 'aaaaaa', action: 'drop' });
    expect(commitEditBodySchema.parse({ hash: 'aaaaaa', action: 'squash' })).toEqual({ hash: 'aaaaaa', action: 'squash' });
    expect(commitEditBodySchema.parse({ hash: 'aaaaaa', action: 'fixup' })).toEqual({ hash: 'aaaaaa', action: 'fixup' });
  });
  it('hash 空串/缺失或 action 非法 → 抛错', () => {
    expect(() => commitEditBodySchema.parse({ hash: '', action: 'drop' })).toThrow();
    expect(() => commitEditBodySchema.parse({ action: 'drop' })).toThrow();
    expect(() => commitEditBodySchema.parse({ hash: 'aaaaaa', action: 'amend' })).toThrow();
  });
});

describe('checkoutRebaseBodySchema（检出并变基到当前：GitCheckoutWithRebaseAction 语义）', () => {
  it('branch 必填；localName 可选（远程分支新本地名）', () => {
    expect(checkoutRebaseBodySchema.parse({ branch: 'origin/main' })).toEqual({ branch: 'origin/main' });
    expect(checkoutRebaseBodySchema.parse({ branch: 'side', localName: 'side-local' }))
      .toEqual({ branch: 'side', localName: 'side-local' });
  });
  it('branch 空串/缺失或 localName 空串 → 抛错', () => {
    expect(() => checkoutRebaseBodySchema.parse({ branch: '' })).toThrow();
    expect(() => checkoutRebaseBodySchema.parse({})).toThrow();
    expect(() => checkoutRebaseBodySchema.parse({ branch: 'main', localName: '' })).toThrow();
  });
});

describe('checkoutUpdateBodySchema（检出并更新：GitCheckoutWithUpdateAction 语义）', () => {
  it('branch 必填；strategy 可省（缺省 merge）并限 merge/rebase', () => {
    expect(checkoutUpdateBodySchema.parse({ branch: 'devel' })).toEqual({ branch: 'devel' });
    expect(checkoutUpdateBodySchema.parse({ branch: 'devel', strategy: 'rebase' }))
      .toEqual({ branch: 'devel', strategy: 'rebase' });
    expect(() => checkoutUpdateBodySchema.parse({ branch: '' })).toThrow();
    expect(() => checkoutUpdateBodySchema.parse({ branch: 'devel', strategy: 'ff' })).toThrow();
  });
});

describe('gpgConfigBodySchema（GPG 提交签名配置：GitGpgConfigDialog 语义）', () => {
  it('enabled=false 可无 key；enabled=true 必须带非空 key', () => {
    expect(gpgConfigBodySchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(gpgConfigBodySchema.parse({ enabled: true, key: 'A1B2C3' })).toEqual({ enabled: true, key: 'A1B2C3' });
    expect(gpgConfigBodySchema.parse({ enabled: false, key: null })).toEqual({ enabled: false, key: null });
  });
  it('enabled=true 却无 key/空 key/null key → 拒绝（refine）', () => {
    expect(() => gpgConfigBodySchema.parse({ enabled: true })).toThrow();
    expect(() => gpgConfigBodySchema.parse({ enabled: true, key: '' })).toThrow();
    expect(() => gpgConfigBodySchema.parse({ enabled: true, key: null })).toThrow();
  });
});

describe('commitAndPushBodySchema（commit & push 组合执行器）', () => {
  it('接受 commit 体 + 可选 push 体（push 缺省=当前分支上游）', () => {
    expect(commitAndPushBodySchema.parse({ message: 'x' })).toEqual({ message: 'x' });
    expect(
      commitAndPushBodySchema.parse({ message: 'x', push: { remote: 'origin', setUpstream: true } }),
    ).toEqual({ message: 'x', push: { remote: 'origin', setUpstream: true } });
  });
  it('拒绝空 message 与 push 内非法字段', () => {
    expect(() => commitAndPushBodySchema.parse({ message: '' })).toThrow();
    expect(() => commitAndPushBodySchema.parse({ message: 'x', push: { forceWithLease: 'yes' } })).toThrow();
  });
});

describe('branchActionSchema（分支写操作）', () => {
  it('接受 create（可带 startPoint）', () => {
    expect(branchActionSchema.parse({ action: 'create', name: 'feat/x' }))
      .toEqual({ action: 'create', name: 'feat/x' });
    expect(branchActionSchema.parse({ action: 'create', name: 'feat/x', startPoint: 'HEAD~1' }))
      .toEqual({ action: 'create', name: 'feat/x', startPoint: 'HEAD~1' });
  });
  it('接受 delete（可带 force）与 rename 与 setUpstream', () => {
    expect(branchActionSchema.parse({ action: 'delete', name: 'feat/x' }))
      .toEqual({ action: 'delete', name: 'feat/x' });
    expect(branchActionSchema.parse({ action: 'delete', name: 'feat/x', force: true }))
      .toEqual({ action: 'delete', name: 'feat/x', force: true });
    expect(branchActionSchema.parse({ action: 'rename', oldName: 'a', newName: 'b' }))
      .toEqual({ action: 'rename', oldName: 'a', newName: 'b' });
    expect(branchActionSchema.parse({ action: 'setUpstream', name: 'a', upstream: 'origin/a' }))
      .toEqual({ action: 'setUpstream', name: 'a', upstream: 'origin/a' });
  });
  it('拒绝枚举外 action、缺字段与空 name', () => {
    expect(() => branchActionSchema.parse({ action: 'merge', name: 'x' })).toThrow();
    expect(() => branchActionSchema.parse({ action: 'create' })).toThrow();
    expect(() => branchActionSchema.parse({ action: 'create', name: '' })).toThrow();
    expect(() => branchActionSchema.parse({ action: 'rename', oldName: 'a' })).toThrow();
    expect(() => branchActionSchema.parse({ action: 'setUpstream', name: 'a', upstream: '' })).toThrow();
  });
});

describe('checkoutActionSchema（检出操作）', () => {
  it('接受 branch / newBranch（可带 startPoint）/ detach', () => {
    expect(checkoutActionSchema.parse({ action: 'branch', name: 'main' }))
      .toEqual({ action: 'branch', name: 'main' });
    expect(checkoutActionSchema.parse({ action: 'newBranch', name: 'feat/x' }))
      .toEqual({ action: 'newBranch', name: 'feat/x' });
    expect(checkoutActionSchema.parse({ action: 'newBranch', name: 'feat/x', startPoint: 'main' }))
      .toEqual({ action: 'newBranch', name: 'feat/x', startPoint: 'main' });
    expect(checkoutActionSchema.parse({ action: 'detach', ref: 'v1.0.0' }))
      .toEqual({ action: 'detach', ref: 'v1.0.0' });
  });
  it('拒绝枚举外 action、缺字段与空 name/ref', () => {
    expect(() => checkoutActionSchema.parse({ action: 'reset', name: 'x' })).toThrow();
    expect(() => checkoutActionSchema.parse({ action: 'branch' })).toThrow();
    expect(() => checkoutActionSchema.parse({ action: 'branch', name: '' })).toThrow();
    expect(() => checkoutActionSchema.parse({ action: 'detach' })).toThrow();
    expect(() => checkoutActionSchema.parse({ action: 'detach', ref: '' })).toThrow();
  });
});

describe('resetBodySchema（reset 请求体）', () => {
  it('接受 ref（提交哈希/分支/HEAD~n 表达式）与 soft/mixed/hard 三选 mode', () => {
    expect(resetBodySchema.parse({ ref: 'HEAD~1', mode: 'soft' }))
      .toEqual({ ref: 'HEAD~1', mode: 'soft' });
    expect(resetBodySchema.parse({ ref: 'main', mode: 'mixed' }).mode).toBe('mixed');
    expect(resetBodySchema.parse({ ref: 'a1b2c3d', mode: 'hard' }).mode).toBe('hard');
  });
  it('拒绝空 ref、缺字段与枚举外 mode', () => {
    expect(() => resetBodySchema.parse({ ref: '', mode: 'soft' })).toThrow();
    expect(() => resetBodySchema.parse({ mode: 'soft' })).toThrow();
    expect(() => resetBodySchema.parse({ ref: 'HEAD~1' })).toThrow();
    expect(() => resetBodySchema.parse({ ref: 'HEAD~1', mode: 'merge' })).toThrow();
  });
});

describe('mergeBodySchema（合并请求体）', () => {
  it('接受 branch 必填与 noFf/squash/noCommit/message 全选项', () => {
    expect(mergeBodySchema.parse({ branch: 'feat/x' })).toEqual({ branch: 'feat/x' });
    expect(mergeBodySchema.parse({
      branch: 'feat/x', noFf: true, squash: true, noCommit: true, message: '合并说明',
    })).toEqual({ branch: 'feat/x', noFf: true, squash: true, noCommit: true, message: '合并说明' });
  });
  it('拒绝空 branch、缺 branch 与非布尔开关', () => {
    expect(() => mergeBodySchema.parse({ branch: '' })).toThrow();
    expect(() => mergeBodySchema.parse({})).toThrow();
    expect(() => mergeBodySchema.parse({ branch: 'feat/x', squash: 'yes' })).toThrow();
  });
});

describe('resolveConflictBodySchema（冲突解决判别联合）', () => {
  it('接受 ours / theirs 整侧采纳', () => {
    expect(resolveConflictBodySchema.parse({ strategy: 'ours', path: 'a.txt' }))
      .toEqual({ strategy: 'ours', path: 'a.txt' });
    expect(resolveConflictBodySchema.parse({ strategy: 'theirs', path: 'a.txt' }))
      .toEqual({ strategy: 'theirs', path: 'a.txt' });
  });
  it('接受 manual 带合并结果全文 content', () => {
    expect(resolveConflictBodySchema.parse({ strategy: 'manual', path: 'a.txt', content: 'resolved' }))
      .toEqual({ strategy: 'manual', path: 'a.txt', content: 'resolved' });
  });
  it('接受 delete 以删除解决删除/修改冲突', () => {
    expect(resolveConflictBodySchema.parse({ strategy: 'delete', path: 'a.txt' }))
      .toEqual({ strategy: 'delete', path: 'a.txt' });
  });
  it('拒绝 manual 缺 content、枚举外 strategy 与空 path', () => {
    expect(() => resolveConflictBodySchema.parse({ strategy: 'manual', path: 'a.txt' })).toThrow();
    expect(() => resolveConflictBodySchema.parse({ strategy: 'base', path: 'a.txt' })).toThrow();
    expect(() => resolveConflictBodySchema.parse({ strategy: 'ours', path: '' })).toThrow();
    expect(() => resolveConflictBodySchema.parse({ strategy: 'delete', path: '' })).toThrow();
  });
});

describe('stashActionSchema（贮藏操作判别联合）', () => {
  it('接受 save（可带 message 与 includeUntracked）', () => {
    expect(stashActionSchema.parse({ action: 'save' })).toEqual({ action: 'save' });
    expect(stashActionSchema.parse({ action: 'save', message: '进行中', includeUntracked: true }))
      .toEqual({ action: 'save', message: '进行中', includeUntracked: true });
  });
  it('接受 save 带 keepIndex（--keep-index 保持暂存区）', () => {
    expect(stashActionSchema.parse({ action: 'save', keepIndex: true }))
      .toEqual({ action: 'save', keepIndex: true });
    expect(stashActionSchema.parse({ action: 'save', message: 'x', includeUntracked: true, keepIndex: true }))
      .toEqual({ action: 'save', message: 'x', includeUntracked: true, keepIndex: true });
  });
  it('接受 apply / pop / drop 按非负整数 index', () => {
    expect(stashActionSchema.parse({ action: 'apply', index: 0 }))
      .toEqual({ action: 'apply', index: 0 });
    expect(stashActionSchema.parse({ action: 'pop', index: 2 }))
      .toEqual({ action: 'pop', index: 2 });
    expect(stashActionSchema.parse({ action: 'drop', index: 1 }))
      .toEqual({ action: 'drop', index: 1 });
  });
  it('接受 branch 带 index 与非空 name（git stash branch）', () => {
    expect(stashActionSchema.parse({ action: 'branch', index: 0, name: 'feat/from-stash' }))
      .toEqual({ action: 'branch', index: 0, name: 'feat/from-stash' });
  });
  it('拒绝 branch 缺 name 或空 name', () => {
    expect(() => stashActionSchema.parse({ action: 'branch', index: 0 })).toThrow();
    expect(() => stashActionSchema.parse({ action: 'branch', index: 0, name: '' })).toThrow();
  });
  it('拒绝 index 为 -1、非整数或缺失', () => {
    expect(() => stashActionSchema.parse({ action: 'apply', index: -1 })).toThrow();
    expect(() => stashActionSchema.parse({ action: 'pop', index: 0.5 })).toThrow();
    expect(() => stashActionSchema.parse({ action: 'drop' })).toThrow();
  });
  it('拒绝枚举外 action 与非布尔 includeUntracked/keepIndex', () => {
    expect(() => stashActionSchema.parse({ action: 'clear' })).toThrow();
    expect(() => stashActionSchema.parse({ action: 'save', includeUntracked: 'yes' })).toThrow();
    expect(() => stashActionSchema.parse({ action: 'save', keepIndex: 'yes' })).toThrow();
  });
});

describe('changelistActionSchema（变更列表操作判别联合）', () => {
  it('接受 create 带非空 name', () => {
    expect(changelistActionSchema.parse({ action: 'create', name: '进行中' }))
      .toEqual({ action: 'create', name: '进行中' });
  });
  it('接受 rename 带非空 id 与 name', () => {
    expect(changelistActionSchema.parse({ action: 'rename', id: 'cl-1', name: '新名' }))
      .toEqual({ action: 'rename', id: 'cl-1', name: '新名' });
  });
  it('接受 delete 与 setDefault 按非空 id', () => {
    expect(changelistActionSchema.parse({ action: 'delete', id: 'cl-1' }))
      .toEqual({ action: 'delete', id: 'cl-1' });
    expect(changelistActionSchema.parse({ action: 'setDefault', id: 'cl-2' }))
      .toEqual({ action: 'setDefault', id: 'cl-2' });
  });
  it('接受 move 带非空 paths 数组与 targetId', () => {
    expect(changelistActionSchema.parse({ action: 'move', paths: ['a.txt', 'b/c.txt'], targetId: 'cl-1' }))
      .toEqual({ action: 'move', paths: ['a.txt', 'b/c.txt'], targetId: 'cl-1' });
  });
  it('拒绝枚举外 action', () => {
    expect(() => changelistActionSchema.parse({ action: 'clear', id: 'cl-1' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'create', name: 'x', extra: 1 } as unknown)).not.toThrow();
  });
  it('拒绝 create/rename 空 name 或缺字段', () => {
    expect(() => changelistActionSchema.parse({ action: 'create' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'create', name: '' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'rename', id: 'cl-1' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'rename', id: 'cl-1', name: '' })).toThrow();
  });
  it('拒绝 delete/setDefault 空 id 或缺 id', () => {
    expect(() => changelistActionSchema.parse({ action: 'delete' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'delete', id: '' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'setDefault' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'setDefault', id: '' })).toThrow();
  });
  it('拒绝 move 缺 paths/targetId、空数组、空路径或空 targetId', () => {
    expect(() => changelistActionSchema.parse({ action: 'move', targetId: 'cl-1' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'move', paths: ['a.txt'] })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'move', paths: [], targetId: 'cl-1' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'move', paths: [''], targetId: 'cl-1' })).toThrow();
    expect(() => changelistActionSchema.parse({ action: 'move', paths: ['a.txt'], targetId: '' })).toThrow();
  });
});

describe('accountBodySchema（添加/覆盖账户）', () => {
  it('接受 host/account/token 全非空', () => {
    expect(accountBodySchema.parse({ host: 'github.com', account: 'zhang', token: 'ghp_abc123' }))
      .toEqual({ host: 'github.com', account: 'zhang', token: 'ghp_abc123' });
    expect(accountBodySchema.parse({ host: 'gitlab.example.com', account: '张三', token: 'x' }).host)
      .toBe('gitlab.example.com');
  });
  it('拒绝空 host/account/token 与缺字段', () => {
    expect(() => accountBodySchema.parse({ host: '', account: 'zhang', token: 'ghp_abc123' })).toThrow();
    expect(() => accountBodySchema.parse({ host: 'github.com', account: '', token: 'ghp_abc123' })).toThrow();
    expect(() => accountBodySchema.parse({ host: 'github.com', account: 'zhang', token: '' })).toThrow();
    expect(() => accountBodySchema.parse({ host: 'github.com', account: 'zhang' })).toThrow();
    expect(() => accountBodySchema.parse({})).toThrow();
  });
});

describe('accountDeleteBodySchema（删除账户）', () => {
  it('接受非空 host 与 account', () => {
    expect(accountDeleteBodySchema.parse({ host: 'github.com', account: 'zhang' }))
      .toEqual({ host: 'github.com', account: 'zhang' });
  });
  it('拒绝空 host/account 与缺字段', () => {
    expect(() => accountDeleteBodySchema.parse({ host: '', account: 'zhang' })).toThrow();
    expect(() => accountDeleteBodySchema.parse({ host: 'github.com', account: '' })).toThrow();
    expect(() => accountDeleteBodySchema.parse({ host: 'github.com' })).toThrow();
    expect(() => accountDeleteBodySchema.parse({})).toThrow();
  });
});

describe('conflictContentsQuerySchema（冲突内容查询）', () => {
  it('接受非空 path', () => {
    expect(conflictContentsQuerySchema.parse({ path: 'a.txt' })).toEqual({ path: 'a.txt' });
  });
  it('拒绝空 path 与缺 path', () => {
    expect(() => conflictContentsQuerySchema.parse({ path: '' })).toThrow();
    expect(() => conflictContentsQuerySchema.parse({})).toThrow();
  });
});

describe('remoteActionSchema（远程写操作判别联合）', () => {
  it('接受 add 带非空 name 与 url', () => {
    expect(remoteActionSchema.parse({ action: 'add', name: 'origin', url: 'https://github.com/u/r.git' }))
      .toEqual({ action: 'add', name: 'origin', url: 'https://github.com/u/r.git' });
  });
  it('接受 remove 与 setUrl', () => {
    expect(remoteActionSchema.parse({ action: 'remove', name: 'origin' }))
      .toEqual({ action: 'remove', name: 'origin' });
    expect(remoteActionSchema.parse({ action: 'setUrl', name: 'origin', url: 'git@github.com:u/r.git' }))
      .toEqual({ action: 'setUrl', name: 'origin', url: 'git@github.com:u/r.git' });
  });
  it('拒绝枚举外 action、缺字段与空 name/url', () => {
    expect(() => remoteActionSchema.parse({ action: 'rename', name: 'a' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'add', name: 'origin' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'add', name: '', url: 'x' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'add', name: 'origin', url: '' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'remove' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'remove', name: '' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'setUrl', name: 'origin' })).toThrow();
    expect(() => remoteActionSchema.parse({ action: 'setUrl', name: 'origin', url: '' })).toThrow();
  });
});

describe('fetchBodySchema（fetch 请求体）', () => {
  it('接受空体（默认全部远程）与指定 remote', () => {
    expect(fetchBodySchema.parse({})).toEqual({});
    expect(fetchBodySchema.parse({ remote: 'origin' })).toEqual({ remote: 'origin' });
  });
  it('拒绝非字符串 remote', () => {
    expect(() => fetchBodySchema.parse({ remote: 1 })).toThrow();
  });
});

describe('pullBodySchema（pull 请求体）', () => {
  it('接受空体、指定 remote 与 rebase 开关', () => {
    expect(pullBodySchema.parse({})).toEqual({});
    expect(pullBodySchema.parse({ remote: 'origin', rebase: true }))
      .toEqual({ remote: 'origin', rebase: true });
  });
  it('拒绝非布尔 rebase', () => {
    expect(() => pullBodySchema.parse({ rebase: 'yes' })).toThrow();
  });
});

describe('pushBodySchema（push 请求体）', () => {
  it('接受空体与全选项', () => {
    expect(pushBodySchema.parse({})).toEqual({});
    expect(pushBodySchema.parse({
      remote: 'origin', branch: 'main', forceWithLease: true, setUpstream: true,
    })).toEqual({ remote: 'origin', branch: 'main', forceWithLease: true, setUpstream: true });
  });
  it('拒绝非布尔开关与非字符串 branch', () => {
    expect(() => pushBodySchema.parse({ forceWithLease: 'yes' })).toThrow();
    expect(() => pushBodySchema.parse({ setUpstream: 1 })).toThrow();
    expect(() => pushBodySchema.parse({ branch: 1 })).toThrow();
  });
  it('hash（Push up to Commit）：接受 hash+/−forceWithLease；hash 与 setUpstream 互斥', () => {
    expect(pushBodySchema.parse({ hash: 'aaaaaa', remote: 'origin' })).toEqual({ hash: 'aaaaaa', remote: 'origin' });
    expect(pushBodySchema.parse({ hash: 'aaaaaa', forceWithLease: true })).toEqual({ hash: 'aaaaaa', forceWithLease: true });
    expect(() => pushBodySchema.parse({ hash: '', remote: 'origin' })).toThrow();
    expect(() => pushBodySchema.parse({ hash: 'aaaaaa', setUpstream: true })).toThrow();
  });
});

describe('updateBodySchema（Update Project 请求体）', () => {
  it('接受 merge / rebase 策略', () => {
    expect(updateBodySchema.parse({ strategy: 'merge' })).toEqual({ strategy: 'merge' });
    expect(updateBodySchema.parse({ strategy: 'rebase' })).toEqual({ strategy: 'rebase' });
  });
  it('拒绝枚举外 strategy 与缺 strategy', () => {
    expect(() => updateBodySchema.parse({ strategy: 'fast-forward' })).toThrow();
    expect(() => updateBodySchema.parse({})).toThrow();
  });
});

describe('rebaseBodySchema（变基请求体）', () => {
  it('接受 onto 必填与可选 branch', () => {
    expect(rebaseBodySchema.parse({ onto: 'origin/main' })).toEqual({ onto: 'origin/main' });
    expect(rebaseBodySchema.parse({ onto: 'main', branch: 'feat/x' }))
      .toEqual({ onto: 'main', branch: 'feat/x' });
  });
  it('拒绝空 onto、缺 onto 与非字符串 branch', () => {
    expect(() => rebaseBodySchema.parse({ onto: '' })).toThrow();
    expect(() => rebaseBodySchema.parse({})).toThrow();
    expect(() => rebaseBodySchema.parse({ onto: 'main', branch: 1 })).toThrow();
  });
});

describe('rebaseTodoQuerySchema（交互式变基 todo 查询）', () => {
  it('接受非空 base', () => {
    expect(rebaseTodoQuerySchema.parse({ base: 'main' })).toEqual({ base: 'main' });
    expect(rebaseTodoQuerySchema.parse({ base: 'HEAD~5' })).toEqual({ base: 'HEAD~5' });
  });
  it('拒绝空 base 与缺 base', () => {
    expect(() => rebaseTodoQuerySchema.parse({ base: '' })).toThrow();
    expect(() => rebaseTodoQuerySchema.parse({})).toThrow();
  });
});

describe('interactiveRebaseBodySchema（交互式变基请求体）', () => {
  it('接受 base 与至少一条 entries（五种 action 全接受）', () => {
    const body = {
      base: 'main',
      entries: [
        { hash: 'a1', action: 'pick' },
        { hash: 'b2', action: 'reword' },
        { hash: 'c3', action: 'squash' },
        { hash: 'd4', action: 'fixup' },
        { hash: 'e5', action: 'drop' },
      ],
    };
    expect(interactiveRebaseBodySchema.parse(body)).toEqual(body);
  });
  it('拒绝空 entries、缺 entries、空 base、空 hash 与枚举外 action', () => {
    expect(() => interactiveRebaseBodySchema.parse({ base: 'main', entries: [] })).toThrow();
    expect(() => interactiveRebaseBodySchema.parse({ base: 'main' })).toThrow();
    expect(() => interactiveRebaseBodySchema.parse({ base: '', entries: [{ hash: 'a1', action: 'pick' }] })).toThrow();
    expect(() => interactiveRebaseBodySchema.parse({ base: 'main', entries: [{ hash: '', action: 'pick' }] })).toThrow();
    expect(() => interactiveRebaseBodySchema.parse({ base: 'main', entries: [{ hash: 'a1', action: 'edit' }] })).toThrow();
  });
});

describe('pickBodySchema（摘樱桃/还原请求体）', () => {
  it('接受至少一个非空哈希（cherry-pick 与 revert 共用）', () => {
    expect(pickBodySchema.parse({ hashes: ['a1b2c3d'] })).toEqual({ hashes: ['a1b2c3d'] });
    expect(pickBodySchema.parse({ hashes: ['a1b2c3d', 'e5f6a7b'] }).hashes).toHaveLength(2);
  });
  it('拒绝空 hashes、空字符串哈希与缺 hashes', () => {
    expect(() => pickBodySchema.parse({ hashes: [] })).toThrow();
    expect(() => pickBodySchema.parse({ hashes: [''] })).toThrow();
    expect(() => pickBodySchema.parse({})).toThrow();
  });
});

describe('tagActionSchema（标签写操作判别联合）', () => {
  it('接受 create（可带 ref 与 message）', () => {
    expect(tagActionSchema.parse({ action: 'create', name: 'v1.0.0' }))
      .toEqual({ action: 'create', name: 'v1.0.0' });
    expect(tagActionSchema.parse({ action: 'create', name: 'v1.0.0', ref: 'HEAD~1', message: '发布' }))
      .toEqual({ action: 'create', name: 'v1.0.0', ref: 'HEAD~1', message: '发布' });
  });
  it('接受 delete 与 push（可带 remote）', () => {
    expect(tagActionSchema.parse({ action: 'delete', name: 'v1.0.0' }))
      .toEqual({ action: 'delete', name: 'v1.0.0' });
    expect(tagActionSchema.parse({ action: 'push', name: 'v1.0.0' }))
      .toEqual({ action: 'push', name: 'v1.0.0' });
    expect(tagActionSchema.parse({ action: 'push', name: 'v1.0.0', remote: 'origin' }))
      .toEqual({ action: 'push', name: 'v1.0.0', remote: 'origin' });
  });
  it('接受 pushAll 与 deleteRemote（可带 remote）', () => {
    expect(tagActionSchema.parse({ action: 'pushAll' })).toEqual({ action: 'pushAll' });
    expect(tagActionSchema.parse({ action: 'pushAll', remote: 'origin' }))
      .toEqual({ action: 'pushAll', remote: 'origin' });
    expect(tagActionSchema.parse({ action: 'deleteRemote', name: 'v1.0.0' }))
      .toEqual({ action: 'deleteRemote', name: 'v1.0.0' });
    expect(tagActionSchema.parse({ action: 'deleteRemote', name: 'v1.0.0', remote: 'origin' }))
      .toEqual({ action: 'deleteRemote', name: 'v1.0.0', remote: 'origin' });
  });
  it('拒绝枚举外 action 与缺 name', () => {
    expect(() => tagActionSchema.parse({ action: 'rename', name: 'x' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'create' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'delete' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'push' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'deleteRemote' })).toThrow();
  });
  it('拒绝空 name 与非字符串 message/ref', () => {
    expect(() => tagActionSchema.parse({ action: 'create', name: '' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'delete', name: '' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'push', name: '' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'deleteRemote', name: '' })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'create', name: 'v1', message: 1 })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'push', name: 'v1', remote: 1 })).toThrow();
    expect(() => tagActionSchema.parse({ action: 'pushAll', remote: 1 })).toThrow();
  });
});

describe('blameQuerySchema（溯源查询）', () => {
  it('接受非空 file', () => {
    expect(blameQuerySchema.parse({ file: 'src/a.txt' })).toEqual({ file: 'src/a.txt' });
  });
  it('拒绝空 file 与缺 file', () => {
    expect(() => blameQuerySchema.parse({ file: '' })).toThrow();
    expect(() => blameQuerySchema.parse({})).toThrow();
  });
});

describe('historyQuerySchema（文件历史查询）', () => {
  it('接受非空 file', () => {
    expect(historyQuerySchema.parse({ file: 'src/a.txt' })).toEqual({ file: 'src/a.txt' });
    expect(historyQuerySchema.parse({ file: 'b/c.md' })).toEqual({ file: 'b/c.md' });
  });
  it('拒绝空 file 与缺 file', () => {
    expect(() => historyQuerySchema.parse({ file: '' })).toThrow();
    expect(() => historyQuerySchema.parse({})).toThrow();
  });
});

describe('committedQuerySchema（Committed Changes 分页查询）', () => {
  it('默认 limit=50、skip=0；查询串数字被 coerce（沿用 log 端点风格）', () => {
    expect(committedQuerySchema.parse({})).toEqual({ limit: 50, skip: 0 });
    expect(committedQuerySchema.parse({ limit: '10', skip: '20' })).toEqual({ limit: 10, skip: 20 });
  });
  it('接受边界 limit=1/200 与 skip=0', () => {
    expect(committedQuerySchema.parse({ limit: '1', skip: '0' })).toEqual({ limit: 1, skip: 0 });
    expect(committedQuerySchema.parse({ limit: 200 }).limit).toBe(200);
  });
  it('拒绝 limit 越界（0/201）、非整数与负 skip', () => {
    expect(() => committedQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => committedQuerySchema.parse({ limit: 201 })).toThrow();
    expect(() => committedQuerySchema.parse({ limit: 1.5 })).toThrow();
    expect(() => committedQuerySchema.parse({ skip: -1 })).toThrow();
    expect(() => committedQuerySchema.parse({ skip: 0.5 })).toThrow();
  });
});

describe('searchQuerySchema（提交搜索查询）', () => {
  it('q 必填；默认 mode=grep、limit=50；limit 查询串被 coerce', () => {
    expect(searchQuerySchema.parse({ q: 'fix' })).toEqual({ q: 'fix', mode: 'grep', limit: 50 });
    expect(searchQuerySchema.parse({ q: 'fix', mode: 'pickaxe', limit: '10' }))
      .toEqual({ q: 'fix', mode: 'pickaxe', limit: 10 });
  });
  it('拒绝空 q、缺 q、枚举外 mode 与 limit 越界（0/101）', () => {
    expect(() => searchQuerySchema.parse({ q: '' })).toThrow();
    expect(() => searchQuerySchema.parse({})).toThrow();
    expect(() => searchQuerySchema.parse({ q: 'fix', mode: 'diff' })).toThrow();
    expect(() => searchQuerySchema.parse({ q: 'fix', limit: 0 })).toThrow();
    expect(() => searchQuerySchema.parse({ q: 'fix', limit: 101 })).toThrow();
    expect(() => searchQuerySchema.parse({ q: 'fix', limit: 1.5 })).toThrow();
  });
});

describe('patchCreateBodySchema（patch 创建请求体）', () => {
  it('接受合法 name（\w.- 字符集）与可选 from/to/staged', () => {
    expect(patchCreateBodySchema.parse({ name: 'my.patch-1' }))
      .toEqual({ name: 'my.patch-1' });
    expect(patchCreateBodySchema.parse({ name: 'p1', from: 'HEAD~1', to: 'HEAD', staged: true }))
      .toEqual({ name: 'p1', from: 'HEAD~1', to: 'HEAD', staged: true });
  });
  it('接受 paths（≥1 非空字符串数组，可配 staged）', () => {
    expect(patchCreateBodySchema.parse({ name: 'p1', paths: ['a.txt'] }))
      .toEqual({ name: 'p1', paths: ['a.txt'] });
    expect(patchCreateBodySchema.parse({ name: 'p1', paths: ['a.txt', 'b/c.txt'], staged: true }))
      .toEqual({ name: 'p1', paths: ['a.txt', 'b/c.txt'], staged: true });
  });
  it('拒绝 paths 与 from/to 并存（refine）与空 paths 数组', () => {
    expect(() => patchCreateBodySchema.parse({ name: 'p1', paths: ['a.txt'], from: 'HEAD~1' })).toThrow();
    expect(() => patchCreateBodySchema.parse({ name: 'p1', paths: [] })).toThrow();
    expect(() => patchCreateBodySchema.parse({ name: 'p1', paths: [''] })).toThrow();
  });
  it('拒绝空 name、缺 name 与非法字符 name（a/b、a b）', () => {
    expect(() => patchCreateBodySchema.parse({ name: '' })).toThrow();
    expect(() => patchCreateBodySchema.parse({})).toThrow();
    expect(() => patchCreateBodySchema.parse({ name: 'a/b' })).toThrow();
    expect(() => patchCreateBodySchema.parse({ name: 'a b' })).toThrow();
  });
  it('拒绝非字符串 from/to 与非布尔 staged', () => {
    expect(() => patchCreateBodySchema.parse({ name: 'p1', from: 1 })).toThrow();
    expect(() => patchCreateBodySchema.parse({ name: 'p1', to: 1 })).toThrow();
    expect(() => patchCreateBodySchema.parse({ name: 'p1', staged: 'yes' })).toThrow();
  });
});

describe('patchApplyBodySchema / patchDeleteBodySchema（patch 应用/删除）', () => {
  it('接受非空 name', () => {
    expect(patchApplyBodySchema.parse({ name: 'p1' })).toEqual({ name: 'p1' });
    expect(patchDeleteBodySchema.parse({ name: 'my.patch-1' })).toEqual({ name: 'my.patch-1' });
  });
  it('拒绝空 name 与缺 name', () => {
    expect(() => patchApplyBodySchema.parse({ name: '' })).toThrow();
    expect(() => patchApplyBodySchema.parse({})).toThrow();
    expect(() => patchDeleteBodySchema.parse({ name: '' })).toThrow();
    expect(() => patchDeleteBodySchema.parse({})).toThrow();
  });
});

describe('shelfActionSchema（shelf 操作判别联合）', () => {
  it('接受 save 带合法 name（\w.- 字符集）', () => {
    expect(shelfActionSchema.parse({ action: 'save', name: 'wip-1' }))
      .toEqual({ action: 'save', name: 'wip-1' });
  });
  it('接受 restore 与 drop 带非空 name', () => {
    expect(shelfActionSchema.parse({ action: 'restore', name: 'wip-1' }))
      .toEqual({ action: 'restore', name: 'wip-1' });
    expect(shelfActionSchema.parse({ action: 'drop', name: 'wip-1' }))
      .toEqual({ action: 'drop', name: 'wip-1' });
  });
  it('拒绝枚举外 action', () => {
    expect(() => shelfActionSchema.parse({ action: 'clear', name: 'x' })).toThrow();
  });
  it('拒绝 save 的非法字符 name（a/b、a b、空串）', () => {
    expect(() => shelfActionSchema.parse({ action: 'save', name: 'a/b' })).toThrow();
    expect(() => shelfActionSchema.parse({ action: 'save', name: 'a b' })).toThrow();
    expect(() => shelfActionSchema.parse({ action: 'save', name: '' })).toThrow();
  });
  it('拒绝缺 name 或空 name（restore/drop 分支）', () => {
    expect(() => shelfActionSchema.parse({ action: 'save' })).toThrow();
    expect(() => shelfActionSchema.parse({ action: 'restore' })).toThrow();
    expect(() => shelfActionSchema.parse({ action: 'drop' })).toThrow();
    expect(() => shelfActionSchema.parse({ action: 'restore', name: '' })).toThrow();
    expect(() => shelfActionSchema.parse({ action: 'drop', name: '' })).toThrow();
  });
});

describe('consoleQuerySchema（控制台分页查询）', () => {
  it('默认 limit=100；查询串数字被 coerce', () => {
    expect(consoleQuerySchema.parse({})).toEqual({ limit: 100 });
    expect(consoleQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
  });
  it('接受边界 limit=1/500', () => {
    expect(consoleQuerySchema.parse({ limit: 1 }).limit).toBe(1);
    expect(consoleQuerySchema.parse({ limit: 500 }).limit).toBe(500);
  });
  it('拒绝 limit 越界（0/501）与非整数', () => {
    expect(() => consoleQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => consoleQuerySchema.parse({ limit: 501 })).toThrow();
    expect(() => consoleQuerySchema.parse({ limit: 1.5 })).toThrow();
  });
});

describe('ignorePutBodySchema（忽略文件整篇写入）', () => {
  it('接受 target 枚举 gitignore/exclude 与内容', () => {
    expect(ignorePutBodySchema.parse({ target: 'gitignore', content: 'node_modules/\n' }))
      .toEqual({ target: 'gitignore', content: 'node_modules/\n' });
    expect(ignorePutBodySchema.parse({ target: 'exclude', content: '*.log' }).target).toBe('exclude');
  });
  it('接受恰好 200_000 长度的 content', () => {
    expect(ignorePutBodySchema.parse({ target: 'gitignore', content: 'x'.repeat(200_000) }).content)
      .toHaveLength(200_000);
  });
  it('拒绝枚举外 target 与超长 content（200_001）', () => {
    expect(() => ignorePutBodySchema.parse({ target: 'global', content: 'x' })).toThrow();
    expect(() => ignorePutBodySchema.parse({ target: 'gitignore', content: 'x'.repeat(200_001) })).toThrow();
  });
});

describe('ignoreAddBodySchema（忽略文件追加行）', () => {
  it('接受非空 path', () => {
    expect(ignoreAddBodySchema.parse({ path: 'dist/' })).toEqual({ path: 'dist/' });
  });
  it('拒绝空 path 与缺 path', () => {
    expect(() => ignoreAddBodySchema.parse({ path: '' })).toThrow();
    expect(() => ignoreAddBodySchema.parse({})).toThrow();
  });
});

describe('githubPrQuerySchema（PR 列表查询）', () => {
  it('state 缺省 open；接受 open/closed/all', () => {
    expect(githubPrQuerySchema.parse({})).toEqual({ state: 'open' });
    expect(githubPrQuerySchema.parse({ state: 'closed' })).toEqual({ state: 'closed' });
    expect(githubPrQuerySchema.parse({ state: 'all' })).toEqual({ state: 'all' });
  });
  it('拒绝 state 非法值', () => {
    expect(githubPrQuerySchema.safeParse({ state: 'merge' }).success).toBe(false);
    expect(githubPrQuerySchema.safeParse({ state: '' }).success).toBe(false);
  });
});

describe('githubPrNumberSchema（PR 编号路径参数）', () => {
  it('接受正整数并 coerce 查询串数字', () => {
    expect(githubPrNumberSchema.parse({ number: 12 })).toEqual({ number: 12 });
    expect(githubPrNumberSchema.parse({ number: '12' })).toEqual({ number: 12 });
  });
  it('拒绝 0、负数、小数与非数字', () => {
    expect(githubPrNumberSchema.safeParse({ number: 0 }).success).toBe(false);
    expect(githubPrNumberSchema.safeParse({ number: -1 }).success).toBe(false);
    expect(githubPrNumberSchema.safeParse({ number: 1.5 }).success).toBe(false);
    expect(githubPrNumberSchema.safeParse({ number: 'abc' }).success).toBe(false);
    expect(githubPrNumberSchema.safeParse({}).success).toBe(false);
  });
});

describe('githubCommentBodySchema（PR 评论请求体）', () => {
  it('接受 1..10_000 字符 body', () => {
    expect(githubCommentBodySchema.parse({ body: '看起来不错' })).toEqual({ body: '看起来不错' });
    expect(githubCommentBodySchema.parse({ body: 'x'.repeat(10_000) }).body).toHaveLength(10_000);
  });
  it('拒绝空 body、缺 body 与超 10_000 字符', () => {
    expect(githubCommentBodySchema.safeParse({ body: '' }).success).toBe(false);
    expect(githubCommentBodySchema.safeParse({}).success).toBe(false);
    expect(githubCommentBodySchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('githubReviewBodySchema（PR review 请求体）', () => {
  it('接受三种 event 与可选 body（可空串）', () => {
    expect(githubReviewBodySchema.parse({ event: 'APPROVE' })).toEqual({ event: 'APPROVE' });
    expect(githubReviewBodySchema.parse({ event: 'REQUEST_CHANGES', body: '改一下' }))
      .toEqual({ event: 'REQUEST_CHANGES', body: '改一下' });
    expect(githubReviewBodySchema.parse({ event: 'COMMENT', body: '' }).event).toBe('COMMENT');
  });
  it('接受恰好 10_000 字符 body', () => {
    expect(githubReviewBodySchema.parse({ event: 'COMMENT', body: 'x'.repeat(10_000) }).body)
      .toHaveLength(10_000);
  });
  it('拒绝枚举外 event、缺 event 与超长 body', () => {
    expect(githubReviewBodySchema.safeParse({ event: 'APPROVE2' }).success).toBe(false);
    expect(githubReviewBodySchema.safeParse({ event: 'APPROVED' }).success).toBe(false);
    expect(githubReviewBodySchema.safeParse({ body: 'x' }).success).toBe(false);
    expect(githubReviewBodySchema.safeParse({ event: 'COMMENT', body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('githubMergeBodySchema（PR 合并请求体）', () => {
  it('接受 merge/squash/rebase', () => {
    expect(githubMergeBodySchema.parse({ method: 'merge' })).toEqual({ method: 'merge' });
    expect(githubMergeBodySchema.parse({ method: 'squash' })).toEqual({ method: 'squash' });
    expect(githubMergeBodySchema.parse({ method: 'rebase' })).toEqual({ method: 'rebase' });
  });
  it('拒绝枚举外 method 与缺 method', () => {
    expect(githubMergeBodySchema.safeParse({ method: 'ff' }).success).toBe(false);
    expect(githubMergeBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('GitHub 域类型对齐', () => {
  it('GitHubPrDetail 继承 GitHubPrSummary（含全部 summary 字段 + 扩展字段）', () => {
    expectTypeOf<GitHubPrDetail>().toMatchTypeOf<GitHubPrSummary>();
    expectTypeOf<GitHubPrSummary>().not.toMatchTypeOf<GitHubPrDetail>();
    expectTypeOf<keyof GitHubPrDetail>().toEqualTypeOf<
      keyof GitHubPrSummary
      | 'body' | 'mergeable' | 'reviewDecision' | 'commentsCount' | 'additions' | 'deletions'
    >();
  });
  it('GitHubTimelineEntry.reviewState 可选', () => {
    expectTypeOf<GitHubTimelineEntry['reviewState']>().toEqualTypeOf<
      'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | undefined
    >();
  });
  it('GitHubStatus.repo/account 可选', () => {
    expectTypeOf<GitHubStatus['repo']>().toEqualTypeOf<GitHubRepoRef | undefined>();
    expectTypeOf<GitHubStatus['account']>().toEqualTypeOf<string | undefined>();
  });
});

describe('gitlabMrQuerySchema（MR 列表查询）', () => {
  it('state 缺省 opened；接受 opened/closed/merged/locked/all', () => {
    expect(gitlabMrQuerySchema.parse({})).toEqual({ state: 'opened' });
    expect(gitlabMrQuerySchema.parse({ state: 'closed' })).toEqual({ state: 'closed' });
    expect(gitlabMrQuerySchema.parse({ state: 'merged' })).toEqual({ state: 'merged' });
    expect(gitlabMrQuerySchema.parse({ state: 'locked' })).toEqual({ state: 'locked' });
    expect(gitlabMrQuerySchema.parse({ state: 'all' })).toEqual({ state: 'all' });
  });
  it('拒绝 state 非法值', () => {
    expect(gitlabMrQuerySchema.safeParse({ state: 'merge' }).success).toBe(false);
    expect(gitlabMrQuerySchema.safeParse({ state: '' }).success).toBe(false);
  });
});

describe('gitlabMrIidSchema（MR iid 路径参数）', () => {
  it('接受正整数并 coerce 查询串数字', () => {
    expect(gitlabMrIidSchema.parse({ iid: 12 })).toEqual({ iid: 12 });
    expect(gitlabMrIidSchema.parse({ iid: '12' })).toEqual({ iid: 12 });
  });
  it('拒绝 0、负数、小数与非数字', () => {
    expect(gitlabMrIidSchema.safeParse({ iid: 0 }).success).toBe(false);
    expect(gitlabMrIidSchema.safeParse({ iid: -1 }).success).toBe(false);
    expect(gitlabMrIidSchema.safeParse({ iid: 1.5 }).success).toBe(false);
    expect(gitlabMrIidSchema.safeParse({ iid: 'abc' }).success).toBe(false);
    expect(gitlabMrIidSchema.safeParse({}).success).toBe(false);
  });
});

describe('gitlabMrCreateBodySchema（创建 MR 请求体）', () => {
  it('接受最小必填（sourceBranch/targetBranch/title）与全字段（含 description）', () => {
    const minimal = { sourceBranch: 'feat/x', targetBranch: 'main', title: '实现 X' };
    expect(gitlabMrCreateBodySchema.parse(minimal)).toEqual(minimal);
    const full = { ...minimal, description: '说明文字' };
    expect(gitlabMrCreateBodySchema.parse(full)).toEqual(full);
  });
  it('接受 title 恰好 255 字符与 description 恰好 20_000 字符', () => {
    expect(gitlabMrCreateBodySchema.parse({
      sourceBranch: 'feat/x', targetBranch: 'main', title: 't'.repeat(255),
    }).title).toHaveLength(255);
    expect(gitlabMrCreateBodySchema.parse({
      sourceBranch: 'feat/x', targetBranch: 'main', title: 't',
      description: 'd'.repeat(20_000),
    }).description).toHaveLength(20_000);
  });
  it('拒绝缺 sourceBranch/targetBranch/title、空字符串与非字符串 title', () => {
    expect(gitlabMrCreateBodySchema.safeParse({ targetBranch: 'main', title: 't' }).success).toBe(false);
    expect(gitlabMrCreateBodySchema.safeParse({ sourceBranch: 'feat/x', title: 't' }).success).toBe(false);
    expect(gitlabMrCreateBodySchema.safeParse({ sourceBranch: 'feat/x', targetBranch: 'main' }).success).toBe(false);
    expect(gitlabMrCreateBodySchema.safeParse({ sourceBranch: '', targetBranch: 'main', title: 't' }).success).toBe(false);
    expect(gitlabMrCreateBodySchema.safeParse({ sourceBranch: 'feat/x', targetBranch: 'main', title: 1 }).success).toBe(false);
  });
  it('拒绝 title 超 255 字符与 description 超 20_000 字符', () => {
    expect(gitlabMrCreateBodySchema.safeParse({
      sourceBranch: 'feat/x', targetBranch: 'main', title: 't'.repeat(256),
    }).success).toBe(false);
    expect(gitlabMrCreateBodySchema.safeParse({
      sourceBranch: 'feat/x', targetBranch: 'main', title: 't',
      description: 'd'.repeat(20_001),
    }).success).toBe(false);
  });
});

describe('gitlabCommentBodySchema（MR 评论请求体）', () => {
  it('接受 1..10_000 字符 body', () => {
    expect(gitlabCommentBodySchema.parse({ body: '看起来不错' })).toEqual({ body: '看起来不错' });
    expect(gitlabCommentBodySchema.parse({ body: 'x'.repeat(10_000) }).body).toHaveLength(10_000);
  });
  it('拒绝空 body、缺 body 与超 10_000 字符', () => {
    expect(gitlabCommentBodySchema.safeParse({ body: '' }).success).toBe(false);
    expect(gitlabCommentBodySchema.safeParse({}).success).toBe(false);
    expect(gitlabCommentBodySchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('gitlabReviewBodySchema（MR review 请求体）', () => {
  it('接受三种 event 与可选 body（可空串）', () => {
    expect(gitlabReviewBodySchema.parse({ event: 'APPROVE' })).toEqual({ event: 'APPROVE' });
    expect(gitlabReviewBodySchema.parse({ event: 'REQUEST_CHANGES', body: '改一下' }))
      .toEqual({ event: 'REQUEST_CHANGES', body: '改一下' });
    expect(gitlabReviewBodySchema.parse({ event: 'COMMENT', body: '' }).event).toBe('COMMENT');
  });
  it('接受恰好 10_000 字符 body', () => {
    expect(gitlabReviewBodySchema.parse({ event: 'COMMENT', body: 'x'.repeat(10_000) }).body)
      .toHaveLength(10_000);
  });
  it('拒绝枚举外 event、缺 event 与超长 body', () => {
    expect(gitlabReviewBodySchema.safeParse({ event: 'APPROVE2' }).success).toBe(false);
    expect(gitlabReviewBodySchema.safeParse({ event: 'APPROVED' }).success).toBe(false);
    expect(gitlabReviewBodySchema.safeParse({ body: 'x' }).success).toBe(false);
    expect(gitlabReviewBodySchema.safeParse({ event: 'COMMENT', body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

describe('gitlabMergeBodySchema（MR 合并请求体）', () => {
  it('接受空体与 squash 布尔开关', () => {
    expect(gitlabMergeBodySchema.parse({})).toEqual({});
    expect(gitlabMergeBodySchema.parse({ squash: true })).toEqual({ squash: true });
    expect(gitlabMergeBodySchema.parse({ squash: false })).toEqual({ squash: false });
  });
  it('拒绝非布尔 squash', () => {
    expect(gitlabMergeBodySchema.safeParse({ squash: 'yes' }).success).toBe(false);
  });
});

describe('GitLab 域类型对齐', () => {
  it('GitLabMrDetail 继承 GitLabMrSummary（含全部 summary 字段 + 扩展字段）', () => {
    expectTypeOf<GitLabMrDetail>().toMatchTypeOf<GitLabMrSummary>();
    expectTypeOf<GitLabMrSummary>().not.toMatchTypeOf<GitLabMrDetail>();
    expectTypeOf<keyof GitLabMrDetail>().toEqualTypeOf<
      keyof GitLabMrSummary
      | 'body' | 'mergeable' | 'reviewState' | 'commentsCount' | 'additions' | 'deletions'
    >();
  });
  it('GitLabTimelineEntry.reviewState 可选', () => {
    expectTypeOf<GitLabTimelineEntry['reviewState']>().toEqualTypeOf<
      'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | undefined
    >();
  });
  it('GitLabStatus.repo/account 可选', () => {
    expectTypeOf<GitLabStatus['repo']>().toEqualTypeOf<GitLabRepoRef | undefined>();
    expectTypeOf<GitLabStatus['account']>().toEqualTypeOf<string | undefined>();
  });
});

describe('worktreeCreateBodySchema（worktree 创建请求体）', () => {
  it('接受 path 必填；branch/newBranch 可选（缺省为 undefined）', () => {
    expect(worktreeCreateBodySchema.parse({ path: '../wt' })).toEqual({ path: '../wt' });
    expect(worktreeCreateBodySchema.parse({ path: '../wt', branch: 'main' }).branch).toBe('main');
    expect(worktreeCreateBodySchema.parse({ path: '../wt' }).branch).toBeUndefined();
    expect(worktreeCreateBodySchema.parse({ path: '../wt', newBranch: 'feat/x' }).newBranch).toBe('feat/x');
    expect(worktreeCreateBodySchema.parse({ path: '../wt' }).newBranch).toBeUndefined();
  });
  it('branch 与 newBranch 可同时给出（互斥约束归服务层，schema 只测形状）', () => {
    expect(worktreeCreateBodySchema.parse({ path: '../wt', branch: 'main', newBranch: 'feat/x' }))
      .toEqual({ path: '../wt', branch: 'main', newBranch: 'feat/x' });
  });
  it('拒绝空 path、缺 path 与空 branch/newBranch', () => {
    expect(worktreeCreateBodySchema.safeParse({ path: '' }).success).toBe(false);
    expect(worktreeCreateBodySchema.safeParse({}).success).toBe(false);
    expect(worktreeCreateBodySchema.safeParse({ path: '../wt', branch: '' }).success).toBe(false);
    expect(worktreeCreateBodySchema.safeParse({ path: '../wt', newBranch: '' }).success).toBe(false);
  });
  it('拒绝非字符串 path/branch/newBranch', () => {
    expect(worktreeCreateBodySchema.safeParse({ path: 1 }).success).toBe(false);
    expect(worktreeCreateBodySchema.safeParse({ path: '../wt', branch: 1 }).success).toBe(false);
    expect(worktreeCreateBodySchema.safeParse({ path: '../wt', newBranch: null }).success).toBe(false);
  });
});

describe('worktreeRemoveBodySchema（worktree 删除请求体）', () => {
  it('接受 path 必填与可选 force（缺省为 undefined）', () => {
    expect(worktreeRemoveBodySchema.parse({ path: '../wt' })).toEqual({ path: '../wt' });
    expect(worktreeRemoveBodySchema.parse({ path: '../wt', force: true }))
      .toEqual({ path: '../wt', force: true });
    expect(worktreeRemoveBodySchema.parse({ path: '../wt', force: false }).force).toBe(false);
    expect(worktreeRemoveBodySchema.parse({ path: '../wt' }).force).toBeUndefined();
  });
  it('拒绝空 path、缺 path 与非布尔 force（\'yes\'）', () => {
    expect(worktreeRemoveBodySchema.safeParse({ path: '' }).success).toBe(false);
    expect(worktreeRemoveBodySchema.safeParse({}).success).toBe(false);
    expect(worktreeRemoveBodySchema.safeParse({ path: '../wt', force: 'yes' }).success).toBe(false);
    expect(worktreeRemoveBodySchema.safeParse({ path: '../wt', force: 1 }).success).toBe(false);
  });
});

describe('submoduleUpdateBodySchema（submodule 更新请求体）', () => {
  it('接受空体与可选 name/recursive（缺省为 undefined）', () => {
    expect(submoduleUpdateBodySchema.parse({})).toEqual({});
    expect(submoduleUpdateBodySchema.parse({ name: 'libs/foo' })).toEqual({ name: 'libs/foo' });
    expect(submoduleUpdateBodySchema.parse({ name: 'libs/foo', recursive: true }))
      .toEqual({ name: 'libs/foo', recursive: true });
    expect(submoduleUpdateBodySchema.parse({}).name).toBeUndefined();
    expect(submoduleUpdateBodySchema.parse({}).recursive).toBeUndefined();
  });
  it('拒绝空 name 与非布尔 recursive（\'yes\'）', () => {
    expect(submoduleUpdateBodySchema.safeParse({ name: '' }).success).toBe(false);
    expect(submoduleUpdateBodySchema.safeParse({ recursive: 'yes' }).success).toBe(false);
    expect(submoduleUpdateBodySchema.safeParse({ name: 'libs/foo', recursive: 1 }).success).toBe(false);
  });
});

describe('worktree 域类型对齐', () => {
  it('WorktreeEntry 键集与 branch 可空（分离 HEAD）', () => {
    expectTypeOf<keyof WorktreeEntry>().toEqualTypeOf<'path' | 'branch' | 'detached' | 'head'>();
    expectTypeOf<WorktreeEntry['branch']>().toEqualTypeOf<string | null>();
    expectTypeOf<keyof WorktreeList>().toEqualTypeOf<'worktrees'>();
  });
});

describe('submodule 域类型对齐', () => {
  it('SubmoduleEntry.status 四值枚举；branch/commitSha 可选', () => {
    expectTypeOf<SubmoduleEntry['status']>().toEqualTypeOf<
      'uninitialized' | 'checked-out' | 'different-commit' | 'conflict'
    >();
    expectTypeOf<SubmoduleEntry['branch']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SubmoduleEntry['commitSha']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<keyof SubmoduleEntry>()
      .toEqualTypeOf<'name' | 'path' | 'url' | 'branch' | 'status' | 'commitSha'>();
    expectTypeOf<keyof SubmoduleList>().toEqualTypeOf<'submodules'>();
  });
});
