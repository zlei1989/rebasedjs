/**
 * 紧凑密度主题：全站「内容文字/组件用小」的唯一定义点（设置页以 density="default" 豁免）。
 * 做什么：把明暗底色算法与紧凑算法组合成一条 algorithm 数组，并把字号三档收紧。
 * 怎么做：antd algorithm 接受数组，按序应用——[底色算法, compactAlgorithm] 即「明暗正确 + 更紧凑」。
 * 注意：间距与控件高度交给 compactAlgorithm，**不重复手调** padding* / controlHeight 种子 token，
 *      否则与算法叠加会过度压缩；lineHeight 亦不动（缩小字号后行高比例已流体，动它易致行框局促）。
 *      调值只改本文件（设计文档 §6）。
 */
import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

/** 明暗模式（web-next 由 useSettings 驱动，web-koa 固定暗色） */
export type DensityMode = 'light' | 'dark';

/**
 * 紧凑密度的字号 token：**只给 `fontSizeSM`**，其余两档交给 compactAlgorithm 派生，实效即 14→12 / 12→11 / 16→14。
 *
 * 为什么不能写 `fontSize`（antd 6.6.3 实测，请勿「顺手补回」）：
 *   `compactAlgorithm` **会覆盖**传入的 `fontSize`——它取「基础算法派生出的 fontSizeSM」作为新基准再推导整档字号
 *   （`es/theme/themes/compact/index.js`：`const fontSize = mergedMapToken.fontSizeSM;` 后 `genFontMapToken(fontSize)`）。
 *   所以显式 `fontSize: 12` 会先让基础算法把 fontSizeSM 派生成 10，compact 再以 10 为基准
 *   → **实效 fontSize = 10**：比设计要求的 12 更小，甚至小于 antd 默认的 14。显式覆盖 `fontSize` 在此适得其反。
 *
 * 实测矩阵（`theme.getDesignToken({ algorithm: [theme.darkAlgorithm, theme.compactAlgorithm], token })`）：
 *   | 传入 token                                     | 实效 fontSize / SM / LG |
 *   | { fontSize:12, fontSizeSM:11, fontSizeLG:14 }  | 10 / 11 / 14  ← 错误写法（覆盖失效） |
 *   | { fontSizeSM: 11 }（本文件）                    | 12 / 11 / 14  ← 设计目标 |
 *   | { fontSize: 12 }                               | 10 /  8 / 12  |
 *   | { fontSize: 12, fontSizeLG: 14 }               | 10 /  8 / 14  |
 *   | {}（不传 token）                                | 12 / 10 / 14  |
 * 即：**`fontSizeSM: 11` 才是产出实效 12 / 11 / 14 的那一项**。
 *
 * 注意：间距与控件高度仍归 compactAlgorithm（见文件头），不要在此补 padding* / controlHeight。
 * 调值只改本文件（设计文档 §6）；实效回归断言见 density.test.ts「实效 token」用例。
 */
export const COMPACT_FONT_TOKENS = {
  fontSizeSM: 11,
} as const;

/** 生成紧凑密度主题：algorithm 依赖明暗，故按 mode 参数化 */
export function compactTheme(mode: DensityMode): ThemeConfig {
  return {
    algorithm: [
      mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm,
      theme.compactAlgorithm,
    ],
    token: { ...COMPACT_FONT_TOKENS },
  };
}
