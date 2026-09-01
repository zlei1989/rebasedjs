/**
 * Vitest 全局 setup（jsdom 组件测试用）
 *
 * 统一补齐 jsdom 缺失的浏览器 API（matchMedia / ResizeObserver），并 stub
 * getComputedStyle 的伪元素重载：jsdom 对 getComputedStyle(el, '::before') 这类带
 * 伪元素参数的调用未实现，会打印 "Not implemented: Window's getComputedStyle()" 噪音
 * （antd cssinjs 触发）。此处包一层，第二参（伪元素）存在时退化为不带伪元素调用，
 * 返回真实计算样式，既消除警告又保留断言可用的样式值。
 */

// setupFiles 在 node 与 jsdom 两种 environment 下都会执行；node 环境无 window，跳过浏览器 API 补齐
if (typeof window !== 'undefined') {
  const original = window.getComputedStyle.bind(window);
  // 第二参（伪元素）存在时退化为不带伪元素调用，规避 jsdom 未实现警告，仍返回真实样式
  window.getComputedStyle = (el: Element, pseudoElt?: string | null) =>
    original(el, pseudoElt ? undefined : pseudoElt);

  // jsdom 缺少 matchMedia：antd 响应式依赖，补齐为恒不匹配
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // jsdom 缺少 ResizeObserver：antd Tree/Table 等依赖，补齐为 no-op
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // jsdom 缺少 IntersectionObserver：@ant-design/x Bubble.List 依赖，补齐为 no-op
  globalThis.IntersectionObserver = class {
    root: Element | Document | null = null;
    rootMargin = '0px';
    thresholds: number[] = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}
