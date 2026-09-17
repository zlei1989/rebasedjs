/**
 * 设置页共用外壳（拆分后的骨架）：可选返回按钮 + 「跳到另一类设置」互跳链接 + 设置页统一的
 * ConfigProvider（componentSize="small"）与 PageShell（density="default"，设置页保持 antd 默认密度）。
 * 为什么要有互跳：全局（应用）设置与仓库设置分属两个页面，缺互跳就会「进去出不来」。
 * 返回按钮可选（onBack 缺省不渲染）：仓库设置页的「返回日志」已由仓库顶栏导航（RepoTopNav）取代，
 * 应用设置页（非仓库作用域，无顶栏导航）仍自带「返回首页」。
 * 导航条形态：antd `Space` + `Divider orientation="vertical"`（两个 link 按钮同一行、中间竖线分隔），
 * Space 而非 Flex：一行内的相邻项间距与分隔线是 Space 的语义（`separator` 逐项插入分隔符），
 * 不用手写 margin/border（AGENT.md：样式一律走 antd，不手调行内边距）。
 * antd 6 口径：用 `Space.separator`（`split` 已废弃）与 `Divider.orientation`（`type` 已废弃）。
 * 注意 Space 的 `separator` 会**逐项之间**插一份分隔符，故 Tooltip 必须作为 Space 的项各自包裹
 * （不再额外嵌套容器，否则分隔符位置与 tooltip 命中区会错位）。
 * 尺寸口径（与拆分前一致）：**本页所有控件一律 `size="small"`**——每个控件逐个显式声明，
 * 页根再包一层 `ConfigProvider componentSize="small"` 兜底 Modal / Popconfirm 等 portal 内默认档控件；
 * antd 的 Checkbox 没有 size 概念（方框尺寸固定），故「勾选框」不受此口径影响。
 */
import { Button, ConfigProvider, Divider, Space, Tooltip } from 'antd';
import type { ReactNode } from 'react';
import { PageShell } from '../base/page-shell';

export interface SettingsShellProps {
  /** 返回按钮文案 */
  backLabel: string;
  /** 返回按钮 Tooltip：说明去向（一对一，避免误导） */
  backTooltip: string;
  /** 返回按钮回调；缺省不渲染返回按钮（如仓库设置页的返回已由仓库顶栏导航承载） */
  onBack?: () => void;
  /** 另一类设置页的入口：文案即去向（如「仓库设置」/「应用设置」） */
  crossLabel: string;
  /** 入口 Tooltip：说明那一页管什么范围 */
  crossTooltip: string;
  /** 入口的稳定测试钩子（app-settings-link / repo-settings-link） */
  crossTestId: string;
  /** 入口禁用态：如「最近仓库为空」时无从指定要配置哪个仓库（禁用态由 crossTooltip 说明原因） */
  crossDisabled?: boolean;
  onCross: () => void;
  children: ReactNode;
}

export function SettingsShell({
  backLabel,
  backTooltip,
  onBack,
  crossLabel,
  crossTooltip,
  crossTestId,
  crossDisabled = false,
  onCross,
  children,
}: SettingsShellProps): ReactNode {
  return (
    <ConfigProvider componentSize="small">
      {/* gap/padding 照抄拆分前的值；density="default"：设置页按 spec D6 保持 antd 默认密度 */}
      <PageShell density="default" gap={16} padding={16}>
        {/* 导航条：返回（可选，缺 onBack 不渲染）与互跳两个 link 同一行、竖线分隔。Space 默认撑满一整行会把链接推到两端，故收回内容宽（左对齐） */}
        {/* size={0}：项间距交给 Divider 的自身外边距，Space 不再额外补一份间距 */}
        <Space size={0} separator={<Divider orientation="vertical" />} style={{ alignSelf: 'flex-start' }}>
          {onBack ? (
            <Tooltip title={backTooltip}>
              <Button size="small" type="link" onClick={onBack}>
                {backLabel}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip title={crossTooltip}>
            {/* 禁用按钮不派发 hover：按 antd 做法在 Tooltip 与 Button 间包一层 span 承接提示 */}
            <span>
              <Button size="small" type="link" data-testid={crossTestId} disabled={crossDisabled} onClick={onCross}>
                {crossLabel}
              </Button>
            </span>
          </Tooltip>
        </Space>
        {children}
      </PageShell>
    </ConfigProvider>
  );
}
