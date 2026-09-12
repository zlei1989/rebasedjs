'use client';

/**
 * antd 客户端 Provider：主题（偏好 auto/light/dark，由服务端应用设置驱动）+ App 包装（message/modal 上下文）。
 * 主题来源 = GET /api/settings（useSettings，与设置页共用同一 SWR 键 → 设置页切换后全站即时生效）；
 * `auto` 在浏览器端按系统偏好（`prefers-color-scheme`）解析成 light/dark 并监听系统变化，故：
 *  - `data-theme` 恒为**解析后**的 light/dark（globals.css / Monaco / 布局断言都只认这两值）；
 *  - `data-theme-preference` 保留用户偏好原值（auto/light/dark），供排障与断言区分「跟随系统」与「显式指定」。
 * 首帧设置未就绪时按暗色兜底（默认观感，SSR 期不闪白；auto 亦按深色首帧，客户端解析后再纠正）。
 * 三处消费点须同步：
 *  1. <ConfigProvider theme>：组件级 token/算法；
 *  2. document.documentElement[data-theme]：globals.css 的 body 底色与 CSS 变量；
 *  3. ConfigProvider.config({ holderRender })：静态 message/Modal.confirm 脱离 React 上下文渲染，
 *     不注册会触发 antd 告警「Static function can not consume context like dynamic theme」并保持暗色。
 */
import { useSettings } from '@rebased/client';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import type { ThemeConfig } from 'antd';
import { DensityProvider } from '@rebased/ui';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

/** 系统深色偏好的媒体查询：auto 模式据此解析（浏览器端唯一判据） */
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  const { settings } = useSettings();
  // 用户偏好（含 auto）；设置未就绪按暗色兜底
  const preference = settings?.theme ?? 'dark';
  // 系统深色偏好：SSR/首帧无 window → 先按深色（与显式 dark 默认一致），挂载后立即解析并订阅变化
  const [systemDark, setSystemDark] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    const sync = (): void => setSystemDark(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  // 生效主题：auto 解析为系统偏好，其余原样；下游（antd 算法/密度/Monaco）只消费 light|dark
  const mode: 'light' | 'dark' = preference === 'auto' ? (systemDark ? 'dark' : 'light') : preference;
  const themeConfig: ThemeConfig = useMemo(
    () => ({ algorithm: mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm }),
    [mode],
  );
  // data-theme 供 globals.css 切底色；data-theme-preference 记录偏好原值；holderRender 让静态 message/Modal 跟随同一主题
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.themePreference = preference;
    ConfigProvider.config({
      theme: themeConfig,
      holderRender: (node) => (
        <ConfigProvider theme={themeConfig}>
          <AntdApp>{node}</AntdApp>
        </ConfigProvider>
      ),
    });
  }, [mode, preference, themeConfig]);
  return (
    <ConfigProvider theme={themeConfig}>
      {/* 明暗 mode 传给 ui 包的 PageShell：其紧凑密度主题需据此选底色算法（auto 已在此解析为实际明暗） */}
      <DensityProvider mode={mode}>
        <AntdApp>{children}</AntdApp>
      </DensityProvider>
    </ConfigProvider>
  );
}
