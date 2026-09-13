/**
 * 最近仓库头像：首字母 + 渐变底色（RecentProjectIconHelper 的 AvatarIcon 等价形态），
 * 路径不可用时转灰并降不透明度（IconUtil.desaturate 的等价）。
 *
 * 色号来自服务端（`RecentRepoInfo.colorIndex`，api 层按 Java ProjectWindowCustomizerService 的
 * 「按项目持久化 + 轮转分配」规则算好）——本组件不做任何取色计算。
 * 明暗判据读文档根 `data-theme` **并订阅其变化**（与 base/monaco-lazy.tsx:45-48 的读法、:54-59 的
 * observeAppTheme 订阅同一手法）：该属性由 app-theme 的 effect（提交之后）写入，写入本身不触发本组件
 * 重渲染，不订阅则主题切换后头像会一直停留在旧明暗支。
 * 刻意不用 useResolvedTheme：那是 app 级钩子，会在每个头像实例上重写 ConfigProvider.config。
 */
import { Avatar } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { avatarGradient, avatarInitials } from './repo-avatar-utils';

export interface RepoAvatarProps {
  /** 头像色号 0..8（服务端下发）：渐变取色 */
  colorIndex: number;
  /** 显示名：取首字母 */
  name: string;
  /** 路径是否仍可用；false → 渐变转灰 + 降不透明度（缺省按可用处理） */
  valid?: boolean;
}

/** 当前明暗：无 document（SSR）或缺省按暗色——与服务端默认主题一致 */
function currentThemeMode(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * 订阅文档根 `<html data-theme>` 变化（照抄 base/monaco-lazy.tsx:54-59 的 observeAppTheme）：
 * 返回取消订阅函数，卸载时 disconnect。
 */
function observeAppTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(() => onChange());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

export function RepoAvatar({ colorIndex, name, valid = true }: RepoAvatarProps): ReactNode {
  // 明暗随文档根 data-theme，并订阅其变化：app-theme 在 effect（提交之后）写该属性，写入不重渲染本组件，
  // 故必须自行订阅，否则主题切换（如 auto 下系统明暗变化）后头像会一直用旧明暗支的渐变
  const [mode, setMode] = useState(currentThemeMode);
  useEffect(() => observeAppTheme(() => setMode(currentThemeMode())), []);
  return (
    <Avatar
      data-testid="repo-avatar"
      shape="square"
      size={32}
      // 底色为品牌色块（非表面色），明暗两支取自 Java JBColor 的同名常量；失效时灰化由 avatarGradient 负责
      style={{
        background: avatarGradient(colorIndex, valid, mode),
        flexShrink: 0,
        ...(valid ? {} : { opacity: 0.6 }),
      }}
    >
      {avatarInitials(name)}
    </Avatar>
  );
}
