/**
 * 空态组件：antd Empty 的统一包装，用于「无数据/无选择」场景。
 * 做法：title 作主标题，description 作副文案，action 渲染在 Empty 下方。
 */
import { Empty } from 'antd';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps): ReactNode {
  return (
    <Empty
      description={
        <div>
          <div>{title}</div>
          {description ? <div>{description}</div> : null}
        </div>
      }
    >
      {action}
    </Empty>
  );
}
