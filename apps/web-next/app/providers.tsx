'use client';

/**
 * antd 客户端 Provider：主题（偏好 auto/light/dark）+ App 包装（message/modal 上下文）。
 * 主题来源 = GET /api/settings（useSettings）→ 偏好交给 @rebased/ui 的 useResolvedTheme 解析；
 * 主题口径（auto 按系统偏好解析、data-theme / data-theme-preference 写入、holderRender 注册）统一在 ui 包，
 * 与 koa 侧同源，两个下游 app 不会漂移：
 *  - `data-theme` 恒为**解析后**的 light/dark（globals.css / Monaco / 布局断言都只认这两值）；
 *  - `data-theme-preference` 保留用户偏好原值（auto/light/dark），供排障与断言区分「跟随系统」与「显式指定」。
 * 三处消费点（ConfigProvider theme / documentElement[data-theme] / ConfigProvider.config 的 holderRender）
 * 由 hook 内部同步，本组件只负责「把偏好喂进去 + 提供 AntdApp 子树的 React 上下文」。
 */
import { useSettings } from '@rebased/client';
import { DensityProvider, useResolvedTheme } from '@rebased/ui';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  const { settings } = useSettings();
  // 用户偏好（含 auto）；设置未就绪按暗色兜底（hook 内默认 dark）
  const { mode, themeConfig } = useResolvedTheme({ preference: settings?.theme });
  return (
    <ConfigProvider theme={themeConfig}>
      {/* 明暗 mode 传给 ui 包的 PageShell：其紧凑密度主题需据此选底色算法（auto 已解析为实际明暗） */}
      <DensityProvider mode={mode}>
        <AntdApp>{children}</AntdApp>
      </DensityProvider>
    </ConfigProvider>
  );
}
