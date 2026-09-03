import { describe, expect, it } from 'vitest';
import {
  commitBodySchema,
  configPutBodySchema,
  diffQuerySchema,
  hunkStagingBodySchema,
  logQuerySchema,
  openRepoBodySchema,
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
