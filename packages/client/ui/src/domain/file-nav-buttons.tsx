/**
 * 多文件「上一个 / 下一个」切换按钮（#27 语义，两个宿主共用）：
 *   · 差异页页头——同组文件来自 `?files=`（提交变更集 / 与工作树差异等入口注入），切文件 = 容器换 URL 的 file
 *     并保留 from/to/staged 等参数；
 *   · 日志页快照栏的**变更集差异标签**——同组文件 = 该提交的变更集，切文件 = 在同一标签栏开/切那个文件的差异标签。
 * 做什么：当前索引由 `file` 在 `files` 里定位；到组首/组尾时对应按钮禁用；`files` 少于 2 个、未注入回调、
 *        或当前文件不在组内（过期链接/路径被改写）时**整组不渲染**——宁可不给导航，也不给一个定位不到当前项的错索引。
 * 为什么抽出来：两处「组内前后翻」是同一件事，各维护一份会让禁用判据、计数与文案慢慢走偏。
 */
import { Button, Flex, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';

export interface FileNavButtonsProps {
  /** 同组文件路径（顺序即翻页顺序） */
  files: string[];
  /** 当前文件路径（用于在组内定位索引） */
  file: string;
  /** 切换回调（携带目标文件路径）；缺省不渲染 */
  onNavigateFile?: (file: string) => void;
  /**
   * 组内只有 1 个文件时也渲染（计数 1/1、两个按钮都禁用）；缺省 false = 整组不渲染。
   * 差异页用缺省（页头已有路径与页面语境，1/1 是噪声）；快照栏的变更集差异标签传 true——
   * 那一条路径栏原本挂的是「与父提交对比」文字，改挂导航后若不渲染就整条空掉，
   * 而 1/1 恰好说明「本提交只动了这一个文件」。
   */
  showSingle?: boolean;
}

export function FileNavButtons({ files, file, onNavigateFile, showSingle = false }: FileNavButtonsProps): ReactNode {
  if (files.length < (showSingle ? 1 : 2) || onNavigateFile === undefined) return null;
  const index = files.indexOf(file);
  if (index < 0) return null; // 当前文件不在组内（如过期 URL）→ 不渲染导航
  const prev = index > 0 ? files[index - 1] : undefined;
  const next = index < files.length - 1 ? files[index + 1] : undefined;
  return (
    <Flex gap={8} align="center" data-testid="diff-file-nav">
      {/* 到组首/组尾时按钮禁用，禁用按钮不派发 hover → 在 Tooltip 与 Button 之间包一层 span 承接提示；
          inline-flex 让 span 紧贴按钮，不改变这一行的布局尺寸 */}
      <Tooltip title={prev === undefined ? '当前文件已是该组第一个，没有上一个可切' : '切到同组的上一个文件（保留当前对比设置）'}>
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            disabled={prev === undefined}
            data-testid="diff-prev-file"
            onClick={() => prev !== undefined && onNavigateFile(prev)}
          >
            ‹ 上一个
          </Button>
        </span>
      </Tooltip>
      <Typography.Text type="secondary">
        {index + 1}/{files.length}
      </Typography.Text>
      <Tooltip title={next === undefined ? '当前文件已是该组最后一个，没有下一个可切' : '切到同组的下一个文件（保留当前对比设置）'}>
        <span style={{ display: 'inline-flex' }}>
          <Button
            size="small"
            disabled={next === undefined}
            data-testid="diff-next-file"
            onClick={() => next !== undefined && onNavigateFile(next)}
          >
            下一个 ›
          </Button>
        </span>
      </Tooltip>
    </Flex>
  );
}
