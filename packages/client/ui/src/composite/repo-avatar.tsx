/**
 * 最近仓库头像：首字母 + 渐变底色（RecentProjectIconHelper 的 AvatarIcon 等价形态），
 * 路径不可用时转灰并降不透明度（IconUtil.desaturate 的等价）。
 *
 * 色号来自服务端（`RecentRepoInfo.colorIndex`，api 层按 Java ProjectWindowCustomizerService 的
 * 「按项目持久化 + 轮转分配」规则算好）——本组件不做任何取色计算。
 * 明暗判据读文档根 `data-theme`（base/app-theme 写入；与 base/monaco-lazy.tsx:47 同一手法）——
 * 刻意不用 useResolvedTheme：那是 app 级钩子，会在每个头像实例上重写 ConfigProvider.config。
 */
import { Avatar } from 'antd';
import type { ReactNode } from 'react';
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

export function RepoAvatar({ colorIndex, name, valid = true }: RepoAvatarProps): ReactNode {
  return (
    <Avatar
      data-testid="repo-avatar"
      shape="square"
      size={32}
      // 底色为品牌色块（非表面色），明暗两支取自 Java JBColor 的同名常量；失效时灰化由 avatarGradient 负责
      style={{
        background: avatarGradient(colorIndex, valid, currentThemeMode()),
        flexShrink: 0,
        ...(valid ? {} : { opacity: 0.6 }),
      }}
    >
      {avatarInitials(name)}
    </Avatar>
  );
}
