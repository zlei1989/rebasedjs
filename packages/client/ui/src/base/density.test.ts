/**
 * 紧凑密度主题测试：断言明暗底色算法与紧凑算法被正确组合，并断言**合并后的实效 token**。
 * 注：本文件导入 antd（theme）以比较算法函数引用/调用 getDesignToken，故留在默认 jsdom 环境，
 *    不套用 AGENT.md 的 node 环境优化（该优化面向不 import 框架的纯函数）。
 *
 * 为什么必须断言实效 token（教训）：compactAlgorithm 会**覆盖**传入的 fontSize（见 density.ts 的实测矩阵），
 *   而「compactTheme('dark').token 等于 { fontSize:12, … }」这类断言只看配置字面量，对该覆盖完全无感——
 *   首轮评审即因此绿灯漏过「实效 10px」的缺陷。需求是结果（正文变 12px），故断言结果。
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

  it('字号收紧到紧凑档：实效 token 为 12 / 11 / 14（断言合并结果，而非配置字面量）', () => {
    // 直接喂 compactTheme 的真实产物，覆盖「algorithm + token 接线是否正确」与「合并后的实效值」
    const dark = theme.getDesignToken(compactTheme('dark'));
    expect(dark.fontSize).toBe(12);
    expect(dark.fontSizeSM).toBe(11);
    expect(dark.fontSizeLG).toBe(14);

    // 明暗两模式的三档字号应一致（防两分支接错算法后字号悄悄漂移）
    const light = theme.getDesignToken(compactTheme('light'));
    expect(light.fontSize).toBe(12);
    expect(light.fontSizeSM).toBe(11);
    expect(light.fontSizeLG).toBe(14);
  });

  it('回归：实效 fontSize 恰为 12（任何显式 fontSize 都会把它压到 10，须响亮失败）', () => {
    // 用 brief 给定的显式组合做同一测量，确保结论不依赖 compactTheme 的实现细节
    const effective = theme.getDesignToken({
      algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
      token: { ...COMPACT_FONT_TOKENS },
    });
    // 强断言：不是 < 14，而是恰为 12——重新引入显式 fontSize 会得到 10，此处立刻变红
    expect(effective.fontSize).toBe(12);
    // 成因断言：与上面的结果断言配对，失败时直接把读代码的人指向「不要给 fontSize」
    expect(Object.keys(COMPACT_FONT_TOKENS)).toEqual(['fontSizeSM']);
  });
});
