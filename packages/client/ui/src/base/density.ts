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

/** 紧凑密度的字号 token：14→12 / 12→11 / 16→14（antd 自身 small 规格的量级） */
export const COMPACT_FONT_TOKENS = {
  fontSize: 12,
  fontSizeSM: 11,
  fontSizeLG: 14,
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
