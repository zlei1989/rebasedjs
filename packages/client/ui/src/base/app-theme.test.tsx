// @vitest-environment jsdom
/** app-theme.tsx 测试：偏好 → 实际明暗解析 + useResolvedTheme 写 data-theme/偏好、跟随系统、holderRender 同一主题 */
import { render, renderHook, act, waitFor } from '@testing-library/react';
import { theme } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { resolveThemeMode, useResolvedTheme } from './app-theme';

/** setup.ts 提供的 matchMedia 兜底实现：用例结束需还原，否则污染同环境后续测试 */
const ORIGINAL_MATCH_MEDIA = window.matchMedia;

/** 可外部改判的 matchMedia 假实现：记录订阅/退订次数，供「系统偏好变化即时生效」「卸载退订」用例断言 */
function stubMatchMedia(initialMatches: boolean): {
  change: (matches: boolean) => void;
  addCalls: () => number;
  removeCalls: () => number;
} {
  let matches = initialMatches;
  let addCalls = 0;
  let removeCalls = 0;
  const listeners = new Set<() => void>();
  const media = {
    get matches(): boolean {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, listener: () => void): void => {
      addCalls += 1;
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void): void => {
      removeCalls += 1;
      listeners.delete(listener);
    },
    addListener: (): void => undefined,
    removeListener: (): void => undefined,
    dispatchEvent: (): boolean => true,
  };
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
  return {
    change: (next: boolean): void => {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
    addCalls: (): number => addCalls,
    removeCalls: (): number => removeCalls,
  };
}

beforeEach(() => {
  // data-theme 是上一用例写的全局态，每个用例从干净的文档根开始
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});

afterEach(() => {
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
});

describe('resolveThemeMode', () => {
  it('显式 light/dark 原样返回，auto 跟随系统偏好', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
    expect(resolveThemeMode('auto', true)).toBe('dark');
    expect(resolveThemeMode('auto', false)).toBe('light');
  });
});

describe('useResolvedTheme', () => {
  it('偏好未就绪 → 暗色兜底（mode=dark、暗色算法、data-theme=dark）', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useResolvedTheme());

    expect(result.current.preference).toBe('dark');
    expect(result.current.mode).toBe('dark');
    expect(result.current.themeConfig.algorithm).toBe(theme.darkAlgorithm);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('偏好 light → 明亮算法 + data-theme=light + data-theme-preference=light（忽略系统深色）', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useResolvedTheme({ preference: 'light' }));

    expect(result.current.mode).toBe('light');
    expect(result.current.themeConfig.algorithm).toBe(theme.defaultAlgorithm);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('light');
  });

  it('偏好 auto：按系统偏好解析，系统明暗变化后无需重挂载即生效，卸载时退订', () => {
    const media = stubMatchMedia(true);
    const { result, unmount } = renderHook(() => useResolvedTheme({ preference: 'auto' }));

    expect(result.current.mode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('auto');
    expect(media.addCalls()).toBe(1);

    // 系统切浅色 → 立即重解析（data-theme 与算法同步跟随）
    act(() => {
      media.change(false);
    });
    expect(result.current.mode).toBe('light');
    expect(result.current.themeConfig.algorithm).toBe(theme.defaultAlgorithm);
    expect(document.documentElement.dataset.theme).toBe('light');

    unmount();
    expect(media.removeCalls()).toBe(1);
  });

  it('apply:false 只解析不落文档根（不写 data-theme）', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useResolvedTheme({ preference: 'light', apply: false }));

    expect(result.current.mode).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('holderRender 用同一主题配置渲染，并注册进 antd 静态渲染器（静态 message/Modal 跟随主题）', async () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useResolvedTheme({ preference: 'dark' }));

    // holderRender 输出被 AntdApp 承载（静态 message/Modal 的 portal 宿主）
    render(result.current.holderRender(createElement('span', { 'data-testid': 'notice' }, 'notice')));
    expect(await waitFor(() => document.querySelector('.ant-app'))).toBeTruthy();
    expect(document.querySelector('[data-testid="notice"]')).toBeTruthy();
    // 主题配置与 hook 返回值同源（算法引用一致）
    expect(result.current.themeConfig.algorithm).toBe(theme.darkAlgorithm);
  });
});
