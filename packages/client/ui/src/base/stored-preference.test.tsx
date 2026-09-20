import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readStoredPreference, useStoredPreference, useStoredWidth } from './stored-preference';

/** 枚举偏好的解析器夹具：只认 'side' / 'inline' 两个值（模拟并排/行内这类有限取值） */
const parseLayout = (raw: string): 'side' | 'inline' | null => (raw === 'side' || raw === 'inline' ? raw : null);

describe('readStoredPreference（localStorage 逐项记忆的读取口径）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('没有存过：回落 seed（首次进入用默认值）', () => {
    expect(readStoredPreference('rebased.diff.sideBySide', false, (raw) => (raw === '1' ? true : null))).toBe(false);
  });

  it('存过：读回解析后的值（刷新/新标签页按最后一次要求）', () => {
    window.localStorage.setItem('rebased.diff.sideBySide', '1');
    expect(readStoredPreference('rebased.diff.sideBySide', false, (raw) => (raw === '1' ? true : null))).toBe(true);
  });

  it('存量值解析不了（旧版本格式 / 手改）：回落 seed，不抛错', () => {
    window.localStorage.setItem('rebased.diff.layout', 'diagonal');
    expect(readStoredPreference('rebased.diff.layout', 'side', parseLayout)).toBe('side');
  });

  it('无 window 的环境（SSR）：回落 seed，不碰 localStorage', () => {
    const original = globalThis.window;
    // @ts-expect-error 测试里刻意抹掉 window 以复现 SSR 首帧
    delete globalThis.window;
    try {
      expect(readStoredPreference('rebased.diff.layout', 'side', parseLayout)).toBe('side');
    } finally {
      globalThis.window = original;
    }
  });
});

describe('useStoredPreference（偏好钩子）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('初值取存量值；更新即写回（下一次挂载读到的就是新值）', () => {
    const first = renderHook(() => useStoredPreference('rebased.diff.layout', 'side', parseLayout));
    expect(first.result.current[0]).toBe('side');
    act(() => first.result.current[1]('inline'));
    expect(first.result.current[0]).toBe('inline');
    expect(window.localStorage.getItem('rebased.diff.layout')).toBe('inline');
    // 新标签页 = 新挂载：读到最后一次要求
    const second = renderHook(() => useStoredPreference('rebased.diff.layout', 'side', parseLayout));
    expect(second.result.current[0]).toBe('inline');
  });

  it('seed 只作「没存过」时的初值：存量值不随 seed 变化重置', () => {
    window.localStorage.setItem('rebased.diff.layout', 'inline');
    const { result } = renderHook(() => useStoredPreference('rebased.diff.layout', 'side', parseLayout));
    expect(result.current[0]).toBe('inline');
  });
});

describe('useStoredWidth（数值偏好：夹紧 + 取整 + 坏值回落）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('没存过：回落 seed', () => {
    const { result } = renderHook(() => useStoredWidth('rebased.blame.treeWidth', 240, 80, 480));
    expect(result.current[0]).toBe(240);
  });

  it('存量值越界（旧版本范围 / 被手改）：读回时夹紧', () => {
    window.localStorage.setItem('rebased.blame.treeWidth', '9999');
    const { result } = renderHook(() => useStoredWidth('rebased.blame.treeWidth', 240, 80, 480));
    expect(result.current[0]).toBe(480);
  });

  it('存量值不是数字：回落 seed，不抛错', () => {
    window.localStorage.setItem('rebased.blame.treeWidth', 'abc');
    const { result } = renderHook(() => useStoredWidth('rebased.blame.treeWidth', 240, 80, 480));
    expect(result.current[0]).toBe(240);
  });

  it('更新：取整 + 夹紧 + 写回本机（新挂载读到最后一次要求）', () => {
    const { result } = renderHook(() => useStoredWidth('rebased.blame.treeWidth', 240, 80, 480));
    act(() => result.current[1](301.6));
    expect(result.current[0]).toBe(302);
    expect(window.localStorage.getItem('rebased.blame.treeWidth')).toBe('302');
    act(() => result.current[1](10));
    expect(result.current[0]).toBe(80);
    const second = renderHook(() => useStoredWidth('rebased.blame.treeWidth', 240, 80, 480));
    expect(second.result.current[0]).toBe(80);
  });
});
