'use client';

/** antd 客户端 Provider：ConfigProvider（theme.darkAlgorithm 暗色）+ App 包装（message/modal 上下文） */
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }): ReactNode {
  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
