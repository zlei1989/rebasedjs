/** 组件测试公共 setup：注册 jest-dom 匹配器（toBeInTheDocument 等） */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest 未开 globals，@testing-library/react 的自动 cleanup 不生效——手动注册，
// 否则多次 render 在 document.body 累积导致 getByText 命中多个元素
afterEach(() => cleanup());

// 纯函数测试文件以 @vitest-environment node 运行（跳过 jsdom 启动提速）：
// 下列 DOM 补丁仅在 jsdom 环境生效，node 下无 window，跳过
if (typeof window !== 'undefined') {
  // jsdom 无 ResizeObserver，antd v6（Tooltip/Segmented 等 rc 组件）依赖它——补空实现
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

  // jsdom 无 window.matchMedia，antd v6 响应式断点（Card 等经 grid/useBreakpoint）依赖它——补空实现
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
