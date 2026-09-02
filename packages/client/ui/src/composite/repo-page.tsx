/**
 * 仓库首页：最近仓库列表 + 打开表单。
 * UX 对齐 #3（spec §6.3）：显示名来自注册 name（三级回退在服务端注册时解析）、
 * 路径副文本 user-home 相对化（`~/…`）、移除带 Popconfirm 确认、最近优先/去重/上限 50。
 * 纯 props 驱动：ui 不调接口，repos/onOpen/onRemove/homeDir 由调用方容器注入 hooks 数据。
 */
import { useMemo, useState } from 'react';
import { Button, Input, Popconfirm } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { RepoInfo } from '@rebased/contracts';
import { EmptyState } from '../base/empty-state';
import { relativeToHome } from './repo-page-utils';

export interface RepoPageProps {
  repos: RepoInfo[];
  /** 打开表单提交（path 为用户输入的仓库路径） */
  onOpen: (path: string) => void;
  /** 移除确认后回调（repoId） */
  onRemove?: (repoId: string) => void;
  /** 用户主目录：浏览器端无法读 os.homedir()，由容器注入用于路径副文本相对化 */
  homeDir?: string;
}

/** 最近列表上限（对齐 Java RecentProjectsManagerBase 上限 50） */
const MAX_RECENT = 50;

export function RepoPage({ repos, onOpen, onRemove, homeDir = '' }: RepoPageProps): React.ReactNode {
  const [openPath, setOpenPath] = useState('');
  // 最近优先（openedAt 降序）→ 同路径去重（保留最近一条）→ 截断上限 50
  const visible = useMemo(() => {
    const sorted = [...repos].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    const seen = new Set<string>();
    const out: RepoInfo[] = [];
    for (const repo of sorted) {
      if (seen.has(repo.path)) continue;
      seen.add(repo.path);
      out.push(repo);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }, [repos]);

  const submitOpen = (): void => {
    const path = openPath.trim();
    if (path) onOpen(path);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          placeholder="仓库路径"
          value={openPath}
          onChange={(e) => setOpenPath(e.target.value)}
          onPressEnter={submitOpen}
        />
        <Button type="primary" onClick={submitOpen}>
          打开
        </Button>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="暂无最近仓库" description="输入路径打开一个 Git 仓库" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {visible.map((repo) => (
            <div
              key={repo.id}
              data-testid="repo-item"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 4px',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{repo.name}</div>
                <div style={{ color: '#888', fontSize: 12 }}>{relativeToHome(repo.path, homeDir)}</div>
              </div>
              <Popconfirm
                title="移除该仓库？"
                okText="确定"
                cancelText="取消"
                onConfirm={() => onRemove?.(repo.id)}
              >
                <Button data-testid="repo-remove" size="small" type="text" icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
