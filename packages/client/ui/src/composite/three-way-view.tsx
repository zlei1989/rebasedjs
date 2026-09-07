/**
 * 三版本对比视图（GitStageCompareThreeVersionsAction 语义）：HEAD → 暂存区、暂存区 → 工作区
 * 上下两个只读 MonacoDiffView，段间以标题区分（暂存区内容相同的一侧为「无差异」）。
 * 纯受控（versions/file 由容器注入）；loader 为测试注入点。
 */
import { Flex, Typography } from 'antd';
import type { FileThreeVersions } from '@rebased/contracts';
import { MonacoDiffView, type MonacoDiffLoader } from '../base/monaco-diff-view';

export interface ThreeWayViewProps {
  versions: FileThreeVersions;
  file: string;
  loader?: MonacoDiffLoader;
}

/** 单段：标题 + MonacoDiffView（height 固定弹性填充） */
function CompareSegment({
  title,
  before,
  after,
  loader,
  testId,
}: {
  title: string;
  before: string;
  after: string;
  loader?: MonacoDiffLoader;
  testId: string;
}): React.ReactNode {
  return (
    <Flex vertical gap={4} style={{ flex: 1, minHeight: 0 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {title}
      </Typography.Text>
      <div data-testid={testId} style={{ flex: 1, minHeight: 120 }}>
        <MonacoDiffView original={before} modified={after} options={{ readOnly: true }} loader={loader} />
      </div>
    </Flex>
  );
}

export function ThreeWayView({ versions, file, loader }: ThreeWayViewProps): React.ReactNode {
  return (
    <Flex vertical gap={12} style={{ height: '100%', padding: 8 }}>
      <Typography.Text strong>{file}（三版本对比）</Typography.Text>
      <CompareSegment
        title="HEAD → 暂存区（已暂存的变更）"
        before={versions.head}
        after={versions.staged}
        loader={loader}
        testId="three-way-head-staged"
      />
      <CompareSegment
        title="暂存区 → 工作区（尚未暂存的变更）"
        before={versions.staged}
        after={versions.working}
        loader={loader}
        testId="three-way-staged-working"
      />
    </Flex>
  );
}
