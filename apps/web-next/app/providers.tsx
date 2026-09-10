'use client';

/**
 * antd 客户端 Provider：主题（暗色/明亮，由服务端应用设置驱动）+ App 包装（message/modal 上下文）。
 * 主题来源 = GET /api/settings（useSettings，与设置页共用同一 SWR 键 → 设置页切换后全站即时生效）；
 * 首帧设置未就绪时按暗色兜底（默认观感，SSR 期不闪白）。
 * 三处消费点须同步：
 *  1. <ConfigProvider theme>：组件级 token/算法；
 *  2. document.documentElement[data-theme]：globals.css 的 body 底色与 CSS 变量；
 *  3. ConfigProvider.config({ holderRender })：静态 message/Modal.confirm 脱离 React 上下文渲染，
 *     不注册会触发 antd 告警「Static function can not consume context like dynamic theme」并保持暗色。
 */
import { useSettings } from '@rebased/client';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import type { ThemeConfig } from 'antd';
import { useEffect, useMemo, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  const { settings } = useSettings();
  const mode = settings?.theme ?? 'dark';
  const themeConfig: ThemeConfig = useMemo(
    () => ({ algorithm: mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm }),
    [mode],
  );
  // data-theme 供 globals.css 切底色；holderRender 让静态 message/Modal 跟随同一主题
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    ConfigProvider.config({
      theme: themeConfig,
      holderRender: (node) => (
        <ConfigProvider theme={themeConfig}>
          <AntdApp>{node}</AntdApp>
        </ConfigProvider>
      ),
    });
  }, [mode, themeConfig]);
  return (
    <ConfigProvider theme={themeConfig}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
