// @vitest-environment node
/**
 * url-select.ts 测试：日志页「选中提交」与 URL 查询串的读写规则（纯函数，无 DOM / 无 git）。
 * 覆盖四条语义：① 读选中（缺省/空值/重复参数都归一为「无选中」）；② 写选中（覆盖而非追加）；
 * ③ 保留其它查询参数（?compare= 等）；④ 不改动入参（调用方可能仍在用原对象）。
 */
import { describe, expect, it } from 'vitest';
import { readParam, readSelect, withSelectParam } from './url-select';

const HASH = '761961d81ca2801637bea2ef42c7a3ca7211e670';

describe('readParam / readSelect（从查询串/参数对象读参数）', () => {
  it('URLSearchParams：有值为该值；缺省与空串都归一为 null', () => {
    expect(readSelect(new URLSearchParams(`select=${HASH}&compare=feature%2Fx`))).toBe(HASH);
    expect(readSelect(new URLSearchParams('compare=feature%2Fx'))).toBeNull();
    expect(readSelect(new URLSearchParams('select='))).toBeNull();
    expect(readSelect(new URLSearchParams())).toBeNull();
  });

  it('Next searchParams 记录：单值原样取；同名参数重复时取第一个（同 URLSearchParams.get 语义）', () => {
    expect(readSelect({ select: HASH, compare: 'feature/x' })).toBe(HASH);
    expect(readSelect({ select: [HASH, 'other'] })).toBe(HASH);
    expect(readSelect({ select: undefined })).toBeNull();
    expect(readSelect({})).toBeNull();
  });

  it('readParam 按名读其它参数（容器读 ?compare= 走同一把尺子）', () => {
    expect(readParam(new URLSearchParams('compare=feature%2Fx'), 'compare')).toBe('feature/x');
    expect(readParam({ compare: ['feature/x', 'other'] }, 'compare')).toBe('feature/x');
    expect(readParam({ compare: '' }, 'compare')).toBeNull();
    expect(readParam({}, 'compare')).toBeNull();
  });
});

describe('withSelectParam（把选中提交写进查询串）', () => {
  it('空查询串：追加 select 且不改动入参', () => {
    const current = new URLSearchParams();
    const next = withSelectParam(current, HASH);
    expect(next.get('select')).toBe(HASH);
    expect(next).not.toBe(current);
    expect(current.toString()).toBe(''); // 入参未被就地修改
  });

  it('已有 select：覆盖为新值且不重复（旧值不残留）', () => {
    const next = withSelectParam(new URLSearchParams('select=deadbeef&compare=feature%2Fx'), HASH);
    expect(next.getAll('select')).toEqual([HASH]);
    expect(next.get('compare')).toBe('feature/x'); // 其它参数随之保留
  });

  it('其它查询参数原样保留（顺序不变，select 追加在末尾）', () => {
    expect(withSelectParam(new URLSearchParams('compare=feature%2Fx'), HASH).toString()).toBe(
      `compare=feature%2Fx&select=${HASH}`,
    );
  });

  it('hash 为 null/空串：删除 select，其余参数保留', () => {
    for (const cleared of [null, '']) {
      const next = withSelectParam(new URLSearchParams(`select=${HASH}&compare=feature%2Fx`), cleared);
      expect(next.has('select')).toBe(false);
      expect(next.toString()).toBe('compare=feature%2Fx');
    }
  });

  it('记录入参：字符串原样、数组按重复键展开、undefined 键跳过', () => {
    const next = withSelectParam({ compare: 'feature/x', tags: ['a', 'b'], blank: undefined }, HASH);
    expect(next.toString()).toBe(`compare=feature%2Fx&tags=a&tags=b&select=${HASH}`);
  });

  it('值按查询串规则编码（空格/&/= 不破坏结构）', () => {
    const next = withSelectParam(new URLSearchParams(), 'a b&c=d');
    expect(next.toString()).toBe('select=a+b%26c%3Dd');
    expect(next.get('select')).toBe('a b&c=d');
  });
});
