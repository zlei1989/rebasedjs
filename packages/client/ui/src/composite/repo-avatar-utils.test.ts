// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AVATAR_GRADIENTS, avatarGradient, avatarInitials } from './repo-avatar-utils';

describe('avatarInitials（AvatarUtils.initials 移植）', () => {
  it('camelCase 恰得两字母：直接取其大写', () => {
    expect(avatarInitials('myProject')).toBe('MP');
  });

  it('单词名：回退 camelCase 结果（单字母）', () => {
    expect(avatarInitials('alpha')).toBe('A');
  });

  it('连字符分隔：取首尾词首字母', () => {
    expect(avatarInitials('rebased-smoke')).toBe('RS');
    expect(avatarInitials('re-based-now')).toBe('RN');
  });

  it('空格分隔：取首尾词首字母', () => {
    expect(avatarInitials('Foo Bar')).toBe('FB');
  });

  it('分隔符按组短路：空格能切出 ≥2 词时不再尝试连字符', () => {
    // Java 的 `?:` 链在「空格」组就拿到 ['a','b-c']（2 词）→ 取首尾词首字母 = 'a' + 'b' = 'AB'，
    // 连字符组根本不会被尝试（所以不是 'AC'）
    expect(avatarInitials('a b-c')).toBe('AB');
  });

  it('词内非字母数字被剔除、纯符号词被丢弃', () => {
    expect(avatarInitials('my_proj.kt')).toBe('MP'); // 下划线组切出 ['my','proj.kt'] → 取首尾词 → 'my' + 'projkt'
    expect(avatarInitials('a - b')).toBe('AB'); // 空格组切出 ['a','-','b'] → '-' 被剔成空词后丢弃 → 首尾为 'a'、'b'
  });

  it('中日韩单字名：回退单字（无大写概念）', () => {
    expect(avatarInitials('旧仓库')).toBe('旧');
  });
});

describe('avatarGradient（ProjectIconPalette.gradients + IconUtil.DesaturationFilter 移植）', () => {
  it('色板 9 组，深浅两支色值逐字照抄 Java JBColor', () => {
    expect(AVATAR_GRADIENTS).toHaveLength(9);
    expect(AVATAR_GRADIENTS[0]).toEqual({ light: ['#DB3D3C', '#FF8E42'], dark: ['#CE443C', '#E77E41'] });
    expect(AVATAR_GRADIENTS[8]).toEqual({ light: ['#E75371', '#FF78B5'], dark: ['#D75370', '#E96FA3'] });
  });

  it('按色号取渐变：0 → 第一组、8 → 第九组、越界回绕', () => {
    expect(avatarGradient(0, true, 'light')).toBe('linear-gradient(135deg, #DB3D3C, #FF8E42)');
    expect(avatarGradient(0, true, 'dark')).toBe('linear-gradient(135deg, #CE443C, #E77E41)');
    expect(avatarGradient(8, true, 'light')).toBe('linear-gradient(135deg, #E75371, #FF78B5)');
    expect(avatarGradient(9, true, 'light')).toBe(avatarGradient(0, true, 'light'));
    // 缺省 mode 走暗色（应用默认主题）
    expect(avatarGradient(0, true)).toBe(avatarGradient(0, true, 'dark'));
  });

  it('valid === false 去饱和：灰阶 = Java DesaturationFilter 的 (max + min) / 2', () => {
    // #DB3D3C → max 219 / min 60 → (219+60)/2 = 139 = 0x8B；#FF8E42 → max 255 / min 66 → 160 = 0xA0
    expect(avatarGradient(0, false, 'light')).toBe('linear-gradient(135deg, #8b8b8b, #a0a0a0)');
    expect(avatarGradient(0, false)).not.toBe(avatarGradient(0, true));
  });
});
