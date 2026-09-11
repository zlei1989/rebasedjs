/**
 * 紧凑密度主题测试：断言明暗底色算法与紧凑算法被正确组合、字号收紧到紧凑档。
 * 注：本文件导入 antd（theme）以比较算法函数引用，故留在默认 jsdom 环境，
 *    不套用 AGENT.md 的 node 环境优化（该优化面向不 import 框架的纯函数）。
 */
import { theme } from 'antd';
import { describe, expect, it } from 'vitest';
import { COMPACT_FONT_TOKENS, compactTheme } from './density';

describe('compactTheme', () => {
  it('暗色模式：底色用 darkAlgorithm 且叠加 compactAlgorithm', () => {
    expect(compactTheme('dark').algorithm).toEqual([theme.darkAlgorithm, theme.compactAlgorithm]);
  });

  it('明亮模式：底色用 defaultAlgorithm 且叠加 compactAlgorithm', () => {
    expect(compactTheme('light').algorithm).toEqual([theme.defaultAlgorithm, theme.compactAlgorithm]);
  });

  it('字号收紧到紧凑档（12/11/14）', () => {
    expect(COMPACT_FONT_TOKENS.fontSize).toBe(12);
    expect(COMPACT_FONT_TOKENS.fontSizeSM).toBe(11);
    expect(COMPACT_FONT_TOKENS.fontSizeLG).toBe(14);
    expect(compactTheme('dark').token).toEqual({ ...COMPACT_FONT_TOKENS });
  });
});
