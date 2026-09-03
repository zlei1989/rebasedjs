/** 测试工具：每个用例渲染独立的全新 SWR 缓存（provider 隔离，避免用例间/文件间串全局缓存） */
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';

/** 用空 Map provider 包裹 children，返回可渲染元素（替代散落于各测试文件的重复定义） */
export function freshCache(children: ReactNode) {
  return createElement(SWRConfig, { value: { provider: () => new Map() } }, children);
}
