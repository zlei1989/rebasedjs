/** 测试环境初始化：node 环境下开启 React act 支持，静音 react-test-renderer 弃用告警 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('react-test-renderer')) return;
  originalError(...args);
};
