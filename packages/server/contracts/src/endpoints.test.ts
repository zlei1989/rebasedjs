import { describe, expect, it } from 'vitest';
import {
  configPutBodySchema,
  diffQuerySchema,
  logQuerySchema,
  openRepoBodySchema,
  settingsPatchSchema,
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
