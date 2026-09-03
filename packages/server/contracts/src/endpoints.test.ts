import { describe, expect, it } from 'vitest';
import {
  branchActionSchema,
  checkoutActionSchema,
  commitBodySchema,
  configPutBodySchema,
  diffQuerySchema,
  hunkStagingBodySchema,
  logQuerySchema,
  openRepoBodySchema,
  conflictContentsQuerySchema,
  mergeBodySchema,
  resetBodySchema,
  resolveConflictBodySchema,
  settingsPatchSchema,
  stagingBodySchema,
} from './endpoints';

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
  });
});

describe('configPutBodySchema', () => {
  it('接受白名单键与字符串值', () => {
    const body = configPutBodySchema.parse({ key: 'user.name', value: '张三' });
    expect(body).toEqual({ key: 'user.name', value: '张三' });
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
  it('message 必填，amend/signOff/noVerify 可选布尔', () => {
    expect(commitBodySchema.parse({ message: '修复：暂存逻辑' })).toEqual({ message: '修复：暂存逻辑' });
    expect(commitBodySchema.parse({ message: 'x', amend: true, signOff: true, noVerify: true }))
      .toEqual({ message: 'x', amend: true, signOff: true, noVerify: true });
  });
  it('拒绝空 message 与非布尔 amend', () => {
    expect(() => commitBodySchema.parse({ message: '' })).toThrow();
    expect(() => commitBodySchema.parse({})).toThrow();
    expect(() => commitBodySchema.parse({ message: 'x', amend: 'yes' })).toThrow();
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
  it('拒绝 manual 缺 content、枚举外 strategy 与空 path', () => {
    expect(() => resolveConflictBodySchema.parse({ strategy: 'manual', path: 'a.txt' })).toThrow();
    expect(() => resolveConflictBodySchema.parse({ strategy: 'base', path: 'a.txt' })).toThrow();
    expect(() => resolveConflictBodySchema.parse({ strategy: 'ours', path: '' })).toThrow();
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
