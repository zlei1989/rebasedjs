/**
 * 最近仓库头像的纯函数：首字母、渐变底色与失效去饱和。
 *
 * 与组件分文件（repo-avatar.tsx）的原因：本模块无 JSX、不 import antd，故可用
 * `// @vitest-environment node` 直测；组件侧一旦 import antd 就无法在 node 环境加载。
 *
 * Java 对照：
 * - `AvatarUtils.initials`（platform/util/ui AvatarUtils.kt:148-187）——首字母算法。
 * - `ProjectIconPalette.gradients`（RecentProjectIconHelper.kt:462-486）——9 组 JBColor(明亮, 暗色) 渐变。
 * - `IconUtil.desaturate` → `DesaturationFilter`（core-ui/src/util/IconUtil.kt:769-779）——失效灰化。
 *
 * 色号**由服务端下发**（`RecentRepoInfo.colorIndex`，分配规则见 api 层 `resolveAvatarColorIndex`：
 * Java `ProjectWindowCustomizerService.getOrGenerateAssociatedColorIndex` + `nextColorIndex` 的等价）。
 * 本模块只做「色号 → CSS」的呈现，不做任何取色/哈希计算。
 */

/** 九组头像渐变（Java ProjectIconPalette.gradients 逐字照抄：light = JBColor 明亮支、dark = 暗色支） */
export const AVATAR_GRADIENTS: ReadonlyArray<{ light: readonly [string, string]; dark: readonly [string, string] }> = [
  { light: ['#DB3D3C', '#FF8E42'], dark: ['#CE443C', '#E77E41'] },
  { light: ['#F57236', '#FCBA3F'], dark: ['#E27237', '#E8A83E'] },
  { light: ['#2BC8BB', '#36EBAE'], dark: ['#2DBCAD', '#35D6A4'] },
  { light: ['#359AF2', '#57DBFF'], dark: ['#3895E1', '#51C5EA'] },
  { light: ['#8379FB', '#85A8FF'], dark: ['#7B75E8', '#7D99EB'] },
  { light: ['#7E54B5', '#9486FF'], dark: ['#7854AD', '#897AE6'] },
  { light: ['#D63CC8', '#F582B9'], dark: ['#8F4593', '#B572E3'] },
  { light: ['#954294', '#C87DFF'], dark: ['#C840B9', '#E074AE'] },
  { light: ['#E75371', '#FF78B5'], dark: ['#D75370', '#E96FA3'] },
];

/** 字母（Java Character.isLetter 的等价：Unicode Letter 类） */
function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}

/** 字母或数字（Java Character.isLetterOrDigit 的等价） */
function isLetterOrDigit(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** 大写字母（Java Character.isUpperCase 的等价） */
function isUpperCase(ch: string): boolean {
  return /\p{Lu}/u.test(ch);
}

/**
 * camelCase 首字母（Java AvatarUtils.generateFromCamelCase 逐句移植）：
 * 跳过前导非字母 → 取连续「字母或数字」段 → 保留首字符与所有大写字母 → 最多取 2 个 → 大写化。
 * 保留原 Java 的怪癖：单段无大写时结果只有 1 个字母（调用方据此回退到分隔符分支）。
 */
function initialsFromCamelCase(text: string): string {
  let start = 0;
  while (start < text.length && !isLetter(text[start])) start++;
  let end = start;
  while (end < text.length && isLetterOrDigit(text[end])) end++;
  const word = text.slice(start, end);
  let out = '';
  for (let i = 0; i < word.length && out.length < 2; i++) {
    if (i === 0 || isUpperCase(word[i])) out += word[i];
  }
  return out.toUpperCase();
}

/** 按「任一给定分隔符」切分（Java split(vararg delimiters) 的等价；不用正则，避免分隔符转义问题） */
function splitOnAny(text: string, delimiters: readonly string[]): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of text) {
    if (delimiters.includes(ch)) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * 按分隔符切分并取「至少 2 个非空词」（Java splitAtLeast2NonEmpty）：
 * 逐段剔除「非字母数字」字符 → 滤掉空段 → 段数 ≥ 2 才返回，否则 null（调用方换下一个分隔符）。
 */
function splitAtLeast2NonEmpty(text: string, delimiters: readonly string[]): string[] | null {
  const words = splitOnAny(text, delimiters)
    .map((part) => [...part].filter((ch) => isLetterOrDigit(ch)).join(''))
    .filter((part) => part !== '');
  return words.length >= 2 ? words : null;
}

/** 分隔符尝试顺序（Java initials 的 `?:` 链）：空格 → 逗号 → 连字符 → 下划线 → 点 → 引号族 */
const DELIMITER_GROUPS: ReadonlyArray<readonly string[]> = [[' '], [','], ['-'], ['_'], ['.'], ['`', '\'', '"']];

/**
 * 头像首字母（Java AvatarUtils.initials 的等价）：
 * 先试 camelCase（恰 2 字母即用）；否则按分隔符组依次取「首尾词首字母」；都拿不到则回退 camelCase 结果。
 * 注意 Java 的两处细节：camelCase 分支用**原始** text，分隔符分支用**剔除代理对并 trim 后**的 text。
 */
export function avatarInitials(name: string): string {
  const camelCase = initialsFromCamelCase(name);
  if (camelCase.length === 2) return camelCase;

  // 剔除 BMP 外字符（Java 的 isHighSurrogate/isLowSurrogate 过滤对成对代理位的等价效果）后 trim
  const filtered = [...name]
    .filter((ch) => (ch.codePointAt(0) ?? 0) <= 0xffff)
    .join('')
    .trim();

  for (const group of DELIMITER_GROUPS) {
    const words = splitAtLeast2NonEmpty(filtered, group);
    if (words !== null) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }
  }
  return camelCase;
}

/**
 * 灰化单个色值（Java `DesaturationFilter.filterRGB` 逐句移植，IconUtil.kt:769-779）：
 * `grey = (max(r,g,b) + min(r,g,b)) / 2`（整数除法——**不是**亮度加权），三通道同值。
 */
function desaturateHex(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const grey = Math.floor((Math.max(r, g, b) + Math.min(r, g, b)) / 2);
  const pair = grey.toString(16).padStart(2, '0');
  return `#${pair}${pair}${pair}`;
}

/**
 * 头像底色渐变 CSS：135 度、起止两色（色号越界回绕）。
 * `valid === false` 时两个端色各按 Java `DesaturationFilter` 的 `(max+min)/2` 灰化后再拼渐变
 * （端色与 Java 逐字一致；中间过渡为两端灰阶线性插值，与 Java 的逐像素灰化略有差异——可接受的等价形态）。
 * `mode` 缺省暗色（应用默认主题 `settings.theme = 'dark'`）；组件按文档根 data-theme 传入实际明暗。
 */
export function avatarGradient(colorIndex: number, valid: boolean, mode: 'light' | 'dark' = 'dark'): string {
  const pair = AVATAR_GRADIENTS[Math.abs(colorIndex) % AVATAR_GRADIENTS.length];
  const [rawFrom, rawTo] = mode === 'dark' ? pair.dark : pair.light;
  const from = valid ? rawFrom : desaturateHex(rawFrom);
  const to = valid ? rawTo : desaturateHex(rawTo);
  return `linear-gradient(135deg, ${from}, ${to})`;
}
