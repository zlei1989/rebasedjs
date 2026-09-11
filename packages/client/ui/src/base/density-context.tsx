/**
 * 密度 context：把「当前明暗」从两个 app 的 Provider 传到 ui 包内的 PageShell。
 * 做什么：承载 DensityMode，供紧凑密度主题选择底色算法。
 * 怎么做：createContext 默认 'dark'（web-koa 固定暗色，亦作 SSR 兜底），
 *        与 PageShell 的 density 豁免（density="default"）互不干扰。
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { DensityMode } from './density';

const DensityModeContext = createContext<DensityMode>('dark');

export interface DensityProviderProps {
  mode: DensityMode;
  children: ReactNode;
}

/** 明暗 mode 提供者：两个 app 各包一层（web-next 用 useSettings 的 theme，web-koa 传 'dark'） */
export function DensityProvider({ mode, children }: DensityProviderProps): ReactNode {
  return <DensityModeContext.Provider value={mode}>{children}</DensityModeContext.Provider>;
}

/** 读取当前明暗 mode；无 Provider 时回退 'dark' */
export function useDensityMode(): DensityMode {
  return useContext(DensityModeContext);
}
