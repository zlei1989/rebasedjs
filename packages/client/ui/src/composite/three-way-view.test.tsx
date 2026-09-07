import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FileThreeVersions } from '@rebased/contracts';
import { ThreeWayView } from './three-way-view';

const VERSIONS: FileThreeVersions = { head: 'v1\n', staged: 'v2\n', working: 'v3\n' };

/** 注入 stub loader，绕过真实 monaco 加载 */
const stubLoader = (): Promise<{ default: () => React.ReactNode }> =>
  Promise.resolve({ default: () => <div>stub-diff-editor</div> });

describe('ThreeWayView', () => {
  it('两段对比（HEAD→暂存、暂存→工作区）标题与路径头', async () => {
    render(<ThreeWayView versions={VERSIONS} file="src/a.ts" loader={stubLoader} />);
    expect(screen.getByText('src/a.ts（三版本对比）')).toBeInTheDocument();
    expect(screen.getByText('HEAD → 暂存区（已暂存的变更）')).toBeInTheDocument();
    expect(screen.getByText('暂存区 → 工作区（尚未暂存的变更）')).toBeInTheDocument();
    expect(await screen.findAllByText('stub-diff-editor')).toHaveLength(2);
    expect(screen.getByTestId('three-way-head-staged')).toBeInTheDocument();
    expect(screen.getByTestId('three-way-staged-working')).toBeInTheDocument();
  });
});
