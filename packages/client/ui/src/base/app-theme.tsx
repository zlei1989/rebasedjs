/**
 * 应用主题解析：把设置里的偏好（auto/light/dark）解析成实际明暗 + antd 主题配置，并落文档根属性。
 * 做什么：`useResolvedTheme(preference)` 读系统偏好解析 auto、产出 `ThemeConfig`（组件级主题）与
 *        `holderRender`（静态 message/Modal 的 portal 渲染器），并写 `html[data-theme]`（解析后）
 *        与 `html[data-theme-preference]`（偏好原值）。
 * 怎么做：**偏好由调用方（app 容器）从 useSettings() 取后以 props 传入**——ui 不调接口（同
 *        DensityProvider / SettingsPage 口径），故本模块不 import @rebased/client；
 *        两个下游 app 共用本模块，主题口径只有一处定义。
 * 注意：三个消费点必须同步，缺一处就会出现「组件亮、底色暗」这类半亮主题：
 *        ① <ConfigProvider theme>；② html[data-theme]（globals/index.css 的底色变量 + Monaco 主题）；
 *        ③ ConfigProvider.config({ holderRender })。
 */
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import type { ThemeConfig } from 'antd';
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react';

/** 主题偏好：auto=跟随操作系统、light=明亮、dark=暗色（与 contracts 的 ThemeMode 同口径，ui 不依赖 contracts 的该类型） */
export type ThemePreference = 'auto' | 'light' | 'dark';

/** 系统深色偏好的媒体查询：auto 模式据此解析（浏览器端唯一判据） */
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

/** 读系统深色偏好；无 matchMedia（SSR / 老环境）按深色——与服务端默认主题一致 */
function readSystemDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/** 偏好 → 实际明暗：auto 跟随系统，其余原样（纯函数，口径单独锁定） */
export function resolveThemeMode(preference: ThemePreference, systemDark: boolean): ThemePreference {
  if (preference !== 'auto') return preference;
  return systemDark ? 'dark' : 'light';
}

export interface UseResolvedThemeOptions {
  /** 偏好原值；未就绪（应用设置还没拉到）按暗色兜底——默认观感，SSR 期不闪白 */
  preference?: ThemePreference;
  /** 是否把解析结果写进文档根与 antd 静态渲染器（默认 true）；不需要时传 false 只取配置 */
  apply?: boolean;
}

export interface ResolvedTheme {
  /** 实际生效的明暗（auto 已解析） */
  mode: 'light' | 'dark';
  /** 用户偏好原值（auto/light/dark），供排障与断言区分「跟随系统」与「显式指定」 */
  preference: ThemePreference;
  /** antd 主题配置（算法随明暗切换） */
  themeConfig: ThemeConfig;
  /** 静态 message/Modal 的 holderRender：脱离 React 上下文渲染时也要跟随同一主题 */
  holderRender: (node: ReactNode) => ReactNode;
}

/**
 * 解析应用主题并同步到文档根。
 * auto 在浏览器端订阅 `prefers-color-scheme` 变化即时重解析（无需刷新）；挂载时订阅、卸载退订。
 */
export function useResolvedTheme({ preference: rawPreference, apply = true }: UseResolvedThemeOptions = {}): ResolvedTheme {
  // 偏好未就绪（应用设置还没拉到）按暗色兜底：默认观感，SSR 期不闪白
  const preference = rawPreference ?? 'dark';
  // 系统深色偏好：SSR/首帧无 window → 先按深色，挂载后立即解析并订阅变化
  const [systemDark, setSystemDark] = useState(readSystemDark);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    const sync = (): void => setSystemDark(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const mode: 'light' | 'dark' = resolveThemeMode(preference, systemDark) === 'light' ? 'light' : 'dark';
  const themeConfig: ThemeConfig = useMemo(
    () => ({ algorithm: mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm }),
    [mode],
  );
  const holderRender = useMemo(
    () => (node: ReactNode) => createElement(ConfigProvider, { theme: themeConfig }, createElement(AntdApp, null, node)),
    [themeConfig],
  );
  useEffect(() => {
    if (!apply) return;
    // data-theme 供 CSS 切底色（globals.css / index.css 的 --app-* 变量）与 Monaco 主题；preference 供排障断言
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themePreference = preference;
    ConfigProvider.config({ theme: themeConfig, holderRender });
  }, [apply, mode, preference, themeConfig, holderRender]);
  return { mode, preference, themeConfig, holderRender };
}
