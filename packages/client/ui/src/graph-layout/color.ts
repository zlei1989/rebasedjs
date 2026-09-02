// Copyright 2000-2026 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license.
// TS 移植自 platform/vcs-log/impl（GraphColorManagerImpl.kt、DefaultColorGenerator.kt）与
// platform/vcs-log/graph impl/print（GraphColorGetterByHead.kt）。
//
// 语义对照（Java 实测）：
// - GraphColorManagerImpl.getColor(headCommit, headFragmentIndex, fragmentIndex)：
//   主线节点（节点 layoutIndex == 其 head 的 layoutIndex）染 head 首个 ref 名 hashCode，
//   无 ref 为 DEFAULT_COLOR=0；fragment 节点染自身 layoutIndex。
// - DefaultColorGenerator：colorId → (r,g,b) = (id*200+30, id*130+50, id*90+100)（int32 回绕），
//   rangeFix(n)=abs(n%100)+70 后 RGBtoHSB → HSBtoRGB(h, saturation=0.4, brightness=0.65)；
//   DEFAULT_COLOR=0 固定映射 JBColor.BLACK。
//   （简报占位 '#888888' 与 Java 默认色语义不符，按「以 Java 实现为准」的裁定取 '#000000'。）
// - ref 名哈希用 Java String.hashCode()（UTF-16 code unit，int32 溢出回绕）。
// - 浮点路径用 Math.fround 保持 Java float 精度（RGBtoHSB/HSBtoRGB 内部为 float 运算）。

const f32 = Math.fround;

/** 默认色：Java GraphColorManagerImpl.DEFAULT_COLOR=0 → DefaultColorGenerator.putDefaultColor → JBColor.BLACK */
export const DEFAULT_COLOR = '#000000';

/** Java DefaultColorGenerator 固定饱和度/亮度（namedFloat 默认值） */
const SATURATION = 0.4;
const BRIGHTNESS = 0.65;

/** Java String.hashCode()（32 位有符号回绕） */
export function javaStringHashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * 分支着色：ref 名哈希 → 稳定色板（Java GraphColorManagerImpl.getColor 主线分支 + DefaultColorGenerator）。
 * 空 ref（head 无引用）返回默认色。
 */
export function colorForRef(ref: string): string {
  if (ref === '') return DEFAULT_COLOR;
  return colorById(javaStringHashCode(ref));
}

/** colorId → 色板色（Java DefaultColorGenerator.calcColor）；colorId=0 为默认黑 */
export function colorById(colorId: number): string {
  if (colorId === 0) return DEFAULT_COLOR;
  const r = rangeFix((colorId * 200 + 30) | 0);
  const g = rangeFix((colorId * 130 + 50) | 0);
  const b = rangeFix((colorId * 90 + 100) | 0);
  // 只取 RGBtoHSB 的色相；饱和度/亮度固定 0.4/0.65（DefaultColorGenerator 实测）
  const [rr, gg, bb] = hsbToRgb(rgbToHue(r, g, b), SATURATION, BRIGHTNESS);
  return toHex(rr, gg, bb);
}

/** Java DefaultColorGenerator.rangeFix：abs(n % 100) + 70 */
function rangeFix(n: number): number {
  return Math.abs(n % 100) + 70;
}

/** Java Color.RGBtoHSB 的色相分支（float32 精度） */
function rgbToHue(r: number, g: number, b: number): number {
  const cmax = Math.max(r, g, b);
  const cmin = Math.min(r, g, b);
  const saturation = cmax !== 0 ? f32(f32(cmax - cmin) / cmax) : 0;
  if (saturation === 0) return 0;
  const redc = f32(f32(cmax - r) / f32(cmax - cmin));
  const greenc = f32(f32(cmax - g) / f32(cmax - cmin));
  const bluec = f32(f32(cmax - b) / f32(cmax - cmin));
  let hue = r === cmax ? f32(bluec - greenc) : g === cmax ? f32(f32(2 + redc) - bluec) : f32(f32(4 + greenc) - redc);
  hue = f32(hue / 6);
  if (hue < 0) hue = f32(hue + 1);
  return hue;
}

/** Java Color.HSBtoRGB（float32 精度；饱和度/亮度为 DefaultColorGenerator 的 0.4/0.65） */
function hsbToRgb(hue: number, saturation: number, brightness: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (saturation === 0) {
    r = g = b = Math.trunc(f32(f32(brightness * 255) + 0.5));
  } else {
    const h = f32(f32(hue - Math.floor(hue)) * 6);
    const f = f32(h - Math.floor(h));
    const p = f32(brightness * f32(1 - saturation));
    const q = f32(brightness * f32(1 - f32(saturation * f)));
    const t = f32(brightness * f32(1 - f32(saturation * f32(1 - f))));
    const scaled = (v: number) => Math.trunc(f32(f32(v * 255) + 0.5));
    switch (Math.trunc(h)) {
      case 0:
        r = scaled(brightness);
        g = scaled(t);
        b = scaled(p);
        break;
      case 1:
        r = scaled(q);
        g = scaled(brightness);
        b = scaled(p);
        break;
      case 2:
        r = scaled(p);
        g = scaled(brightness);
        b = scaled(t);
        break;
      case 3:
        r = scaled(p);
        g = scaled(q);
        b = scaled(brightness);
        break;
      case 4:
        r = scaled(t);
        g = scaled(p);
        b = scaled(brightness);
        break;
      case 5:
        r = scaled(brightness);
        g = scaled(p);
        b = scaled(q);
        break;
      default:
        break;
    }
  }
  return [r, g, b];
}

function toHex(r: number, g: number, b: number): string {
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
