// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { colorById, colorForRef } from './color';

describe('colorForRef', () => {
  it('同一 ref 稳定同色，不同 ref 大概率异色，无 ref 为默认色', () => {
    expect(colorForRef('main')).toBe(colorForRef('main'));
    expect(colorForRef('main')).not.toBe(colorForRef('feature'));
    // Java 实测：GraphColorManagerImpl.DEFAULT_COLOR=0 → DefaultColorGenerator.putDefaultColor → JBColor.BLACK。
    // （简报占位 '#888888' 与 Java 默认色语义不符，按「以 Java 实现为准」的裁定取 '#000000'。）
    expect(colorForRef('')).toBe('#000000');
  });

  it('ref 名哈希 → 色板映射与 Java DefaultColorGenerator 实测一致', () => {
    // Java 1.8 实测（Color.RGBtoHSB + HSBtoRGB，saturation=0.4，brightness=0.65，rangeFix=abs(n%100)+70）
    expect(colorForRef('main')).toBe('#639ba6');
    expect(colorForRef('feature')).toBe('#9763a6');
    expect(colorForRef('fix/abc')).toBe('#6363a6');
    expect(colorForRef('dev')).toBe('#a68563');
    expect(colorForRef('release')).toBe('#9aa663');
    expect(colorForRef('HEAD -> main')).toBe('#6398a6');
  });
});

describe('colorById（fragment 着色：layoutIndex → 色板）', () => {
  it('layoutIndex 色板与 Java 实测一致；0 为默认黑', () => {
    expect(colorById(0)).toBe('#000000');
    expect(colorById(1)).toBe('#639ba6');
    expect(colorById(2)).toBe('#7663a6');
    expect(colorById(3)).toBe('#6374a6');
    expect(colorById(4)).toBe('#63a695');
    expect(colorById(5)).toBe('#8b63a6');
    expect(colorById(6)).toBe('#6363a6');
    expect(colorById(-1)).toBe('#9ca663');
    expect(colorById(-2)).toBe('#9c63a6');
    expect(colorById(-5)).toBe('#a66393');
    expect(colorById(-100)).toBe('#a69363');
    expect(colorById(100)).toBe('#8ba663');
  });
});
