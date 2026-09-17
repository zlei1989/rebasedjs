// @vitest-environment node
/**
 * url-select.ts 测试：日志页「选中提交 + 两个就地面板」与 URL 查询串的读写规则
 * （纯函数，无 DOM / 无 git）。覆盖：① 读选中；② 写选中；③ 两个面板键的**键在即开、值承载定位**
 * （`browse=a.ts` = 该文件在前台、`browse=` = 树在前台；`diff=b.ts` / `diff=` 同理）；
 * ④ 不跑到路径槽里的哨兵（一个真叫 `1` 的文件必须无歧义）；⑤ 保留其它查询参数、不改动入参；
 * ⑥ 旧深链 `?snap=&file=` 的一次性改写。
 */
import { describe, expect, it } from 'vitest';
import {
  diffTabsFromUrl,
  isLegacySnapshotUrl,
  PANEL_AGGREGATE,
  readChanges,
  readChangesPath,
  readBrowse,
  readBrowsePath,
  readPanelPath,
  readParam,
  readSelect,
  syncDiffTabsWithUrl,
  withChangesPanel,
  withBrowsePanel,
  withMigratedSnapshot,
  withSelectParam,
  withoutBrowsePanel,
  withoutChangesPanel,
} from './url-select';

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

describe('两个面板键：键在即开，值承载定位（browse / diff）', () => {
  it('读路径：空值 = 聚合标签在前台，返回值 null；有值 = 该路径在前台', () => {
    expect(readBrowsePath(new URLSearchParams('browse=src%2Fa.ts'))).toBe('src/a.ts');
    // E-empty 的核心：`?browse=` 合法且含义明确（树在前台），不是「没值」
    expect(readBrowsePath(new URLSearchParams('browse='))).toBeNull();
    expect(readBrowsePath(new URLSearchParams('browse'))).toBeNull();
    expect(readBrowsePath(new URLSearchParams('select=x'))).toBeUndefined();
    expect(readChangesPath(new URLSearchParams('diff=lib%2Fb.ts'))).toBe('lib/b.ts');
    expect(readChangesPath(new URLSearchParams('diff='))).toBeNull();
    expect(readChangesPath(new URLSearchParams('select=x'))).toBeUndefined();
  });

  it('读开关：键在即开（`.has` / `!== undefined`），与值是不是空串无关', () => {
    expect(readBrowse(new URLSearchParams('browse=src%2Fa.ts'))).toBe(true);
    expect(readBrowse(new URLSearchParams('browse='))).toBe(true);
    expect(readBrowse(new URLSearchParams('select=x'))).toBe(false);
    expect(readChanges(new URLSearchParams('diff='))).toBe(true);
    expect(readChanges(new URLSearchParams('diff=b.ts'))).toBe(true);
    expect(readChanges(new URLSearchParams('browse='))).toBe(false);
    // Next 记录形态同样按「键在不在」判
    expect(readBrowse({ browse: '' })).toBe(true);
    expect(readBrowse({ browse: [''] })).toBe(true);
    expect(readBrowse({})).toBe(false);
    expect(readChanges({ diff: 'b.ts' })).toBe(true);
  });

  it('readPanelPath 按参数名读（两个键共用同一把尺子）', () => {
    expect(readPanelPath(new URLSearchParams('browse=a.ts'), 'browse')).toBe('a.ts');
    expect(readPanelPath(new URLSearchParams('browse='), 'browse')).toBeNull();
    expect(readPanelPath({ diff: ['b.ts'] }, 'diff')).toBe('b.ts');
    expect(readPanelPath({ diff: [''] }, 'diff')).toBeNull();
    expect(readPanelPath({}, 'diff')).toBeUndefined();
  });

  it('没有「哨兵占路径槽」这回事：一个真叫 `1` 的文件无歧义', () => {
    // 树在前台 = 空值；文件名就叫 1 = 值 "1"（与旧写法 `browse=1` 表示「开着」完全不同）
    expect(readBrowsePath(new URLSearchParams('browse=1'))).toBe('1');
    expect(readBrowsePath(new URLSearchParams('browse='))).toBeNull();
    // 变化集里真有个叫 1 的文件
    expect(readChangesPath(new URLSearchParams('diff=1'))).toBe('1');
    expect(readChangesPath(new URLSearchParams('diff='))).toBeNull();
  });

  it('写：开面板 + 指定定位（路径写进去，聚合标签写空值）', () => {
    const file = withBrowsePanel(new URLSearchParams('select=abc'), 'src/a.ts');
    expect(file.get('browse')).toBe('src/a.ts');
    expect(file.get('select')).toBe('abc');
    // 树在前台：键在、值为空
    const tree = withBrowsePanel(new URLSearchParams('select=abc&browse=src%2Fa.ts'), PANEL_AGGREGATE);
    expect(tree.has('browse')).toBe(true);
    expect(tree.get('browse')).toBe('');
    const list = withChangesPanel(new URLSearchParams('select=abc'), PANEL_AGGREGATE);
    expect(list.get('diff')).toBe('');
    const diff = withChangesPanel(new URLSearchParams('select=abc'), 'lib/b.ts');
    expect(diff.get('diff')).toBe('lib/b.ts');
  });

  it('写：两个键互不代劳（各写各的，另一个原样保留）', () => {
    const both = withChangesPanel(withBrowsePanel(new URLSearchParams('select=abc'), 'a.ts'), 'b.ts');
    expect(both.get('browse')).toBe('a.ts');
    expect(both.get('diff')).toBe('b.ts');
    // 只动 diff：browse 那格（含空值形态）原样留着
    const kept = withChangesPanel(new URLSearchParams('browse='), 'b.ts');
    expect(kept.get('browse')).toBe('');
    expect(kept.get('diff')).toBe('b.ts');
  });

  it('写：关闭 = 删键（另一个键不受影响）', () => {
    const closed = withoutBrowsePanel(new URLSearchParams('select=abc&browse=a.ts&diff=b.ts'));
    expect(closed.has('browse')).toBe(false);
    expect(closed.get('diff')).toBe('b.ts');
    expect(closed.toString()).toBe('select=abc&diff=b.ts');
    const bothClosed = withoutChangesPanel(closed);
    expect(bothClosed.toString()).toBe('select=abc');
  });

  it('写：聚合（`withXPanel(q, null)`）与关闭（`withoutXPanel`）是两件事，别互相顶替', () => {
    const current = new URLSearchParams('select=abc&browse=a.ts');
    // 聚合：键留着、值清空
    expect(withBrowsePanel(current, PANEL_AGGREGATE).toString()).toBe('select=abc&browse=');
    // 关闭：键整个删掉
    expect(withoutBrowsePanel(current).toString()).toBe('select=abc');
    // 入参都没被就地改动
    expect(current.toString()).toBe('select=abc&browse=a.ts');
  });

  it('写：不改动入参、不碰其它查询参数', () => {
    const current = new URLSearchParams('select=abc&compare=feature%2Fx');
    const next = withBrowsePanel(current, 'a.ts');
    expect(current.toString()).toBe('select=abc&compare=feature%2Fx');
    expect(next.get('compare')).toBe('feature/x');
  });

  it('空值往返：`?browse=` 写出去再读回来仍是「键在 + 空值」（刷新可还原「树在前台」）', () => {
    const written = withBrowsePanel(new URLSearchParams('select=abc'), PANEL_AGGREGATE).toString();
    expect(written).toBe('select=abc&browse=');
    const back = new URLSearchParams(written);
    expect(back.has('browse')).toBe(true);
    expect(readBrowsePath(back)).toBeNull();
    expect(readBrowse(back)).toBe(true);
  });

  it('往返：两个键的四种组合都能原样读回', () => {
    const q = withChangesPanel(withBrowsePanel(new URLSearchParams(), 'a b.md'), 'lib/1.ts');
    expect(readBrowsePath(q)).toBe('a b.md');
    expect(readChangesPath(q)).toBe('lib/1.ts');
    expect(q.get('browse')).toBe('a b.md');
    expect(q.get('diff')).toBe('lib/1.ts');
  });

  it('diffTabsFromUrl / syncDiffTabsWithUrl：URL 定位与标签族状态的往返', () => {
    // 首帧深链：`?diff=<路径>` → 该标签开出来并激活（去重，单元素）
    expect(diffTabsFromUrl(new URLSearchParams('select=abc&browse=&diff=lib%2Fb.ts'))).toEqual({
      open: ['lib/b.ts'],
      active: 'lib/b.ts',
    });
    // 首帧没有差异定位：空的标签族
    expect(diffTabsFromUrl(new URLSearchParams('select=abc&diff='))).toEqual({ open: [], active: '' });
    expect(diffTabsFromUrl(new URLSearchParams('select=abc'))).toEqual({ open: [], active: '' });

    const opened = { open: ['a.ts', 'b.ts'], active: 'a.ts' };
    // 地址改成看 b.ts：只切前台，不重复开标签
    expect(syncDiffTabsWithUrl(opened, new URLSearchParams('diff=b.ts'))).toEqual({ open: ['a.ts', 'b.ts'], active: 'b.ts' });
    // 地址带来一个没开过的路径：开出来并激活
    expect(syncDiffTabsWithUrl(opened, new URLSearchParams('diff=c.ts'))).toEqual({
      open: ['a.ts', 'b.ts', 'c.ts'],
      active: 'c.ts',
    });
    // 回清单（聚合值）：前台项清空，**已开标签留着**（会话态不因地址而作废）
    expect(syncDiffTabsWithUrl(opened, new URLSearchParams('diff='))).toEqual({ open: ['a.ts', 'b.ts'], active: '' });
    // 已经一致时返回同一个引用（避免无谓重渲染）
    expect(syncDiffTabsWithUrl(opened, new URLSearchParams('diff=a.ts'))).toBe(opened);
    // 面板关着（键不在）：不动
    expect(syncDiffTabsWithUrl(opened, new URLSearchParams('select=abc'))).toBe(opened);
  });

  it('面板关着时地址里不留定位：关掉即删键，路径不是「空值」而是「没有这个键」', () => {
    const closed = withoutChangesPanel(new URLSearchParams('select=abc&diff=lib%2Fb.ts'));
    expect(closed.has('diff')).toBe(false);
    expect(readChangesPath(closed)).toBeUndefined();
    expect(syncDiffTabsWithUrl({ open: ['lib/b.ts'], active: 'lib/b.ts' }, closed)).toEqual({
      open: ['lib/b.ts'],
      active: 'lib/b.ts',
    });
  });
});

describe('旧深链 ?snap=<hash>（+ ?file=）的一次性改写', () => {
  it('isLegacySnapshotUrl：按**键在不在**判（旧写法里 snap= 可能为空串）', () => {
    expect(isLegacySnapshotUrl(new URLSearchParams(`select=${HASH}&snap=${HASH}`))).toBe(true);
    expect(isLegacySnapshotUrl(new URLSearchParams('snap=&file=a.ts'))).toBe(true);
    expect(isLegacySnapshotUrl({ snap: 'x' })).toBe(true);
    expect(isLegacySnapshotUrl({ snap: '' })).toBe(true);
    expect(isLegacySnapshotUrl(new URLSearchParams('select=x&browse='))).toBe(false);
    expect(isLegacySnapshotUrl({})).toBe(false);
  });

  it('有 ?file=：改写成 browse=<该文件>（旧链接的「这一版 + 这个文件」原样保留），并补上 select', () => {
    const next = withMigratedSnapshot(new URLSearchParams(`snap=${HASH}&file=lib%2Fconfig.js&compare=feature%2Fx`));
    expect(next.has('snap')).toBe(false);
    expect(next.has('file')).toBe(false); // 旧参数不残留（改写后不再有第三种写法）
    expect(next.get('select')).toBe(HASH);
    expect(next.get('browse')).toBe('lib/config.js');
    expect(next.get('compare')).toBe('feature/x');
    expect(readBrowsePath(next)).toBe('lib/config.js');
    expect(readSelect(next)).toBe(HASH);
  });

  it('没有 ?file=：改写成 browse=（树在前台，且面板开着）', () => {
    const next = withMigratedSnapshot(new URLSearchParams(`snap=${HASH}`));
    expect(next.toString()).toBe(`select=${HASH}&browse=`);
    expect(readBrowse(next)).toBe(true);
    expect(readBrowsePath(next)).toBeNull();
  });

  it('已有 select 时不覆盖它（旧链接里 select 才是权威的选中项）', () => {
    const next = withMigratedSnapshot(new URLSearchParams('select=keepme&snap=other&file=a.ts'));
    expect(next.get('select')).toBe('keepme');
    expect(next.get('browse')).toBe('a.ts');
  });

  it('不是旧形态时原样返回（无 snap 键就不动 select / browse）', () => {
    const next = withMigratedSnapshot(new URLSearchParams('select=abc&browse=keep.ts'));
    expect(next.toString()).toBe('select=abc&browse=keep.ts');
  });
});
