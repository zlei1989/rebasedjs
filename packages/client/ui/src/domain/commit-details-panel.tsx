/**
 * 提交详情面板：UX 对齐 #1 字段集（Java CommitDetailsPanel.kt:71-199）。
 * 短 hash + 复制按钮、作者、日期（"{author} on {date} at {time}"）、加粗 subject、
 * 分支/标签 chips（antd Tag 两组）、父提交链接。
 * 文件变更列表与签名状态不进（Java 面板内本来也没有）；无操作按钮（动作在右键菜单，首跑不提供）。
 */
import { Button, Tag } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { CommitInfo } from '@rebased/contracts';
import { classifyRefs } from './refs';
import { formatAuthorLine } from './format';

export interface CommitDetailsPanelProps {
  commit: CommitInfo;
}

export function CommitDetailsPanel({ commit }: CommitDetailsPanelProps): React.ReactNode {
  const { branches, tags } = classifyRefs(commit.refs);
  const subject = commit.message.split('\n')[0];
  const copyHash = (): void => {
    // jsdom/旧浏览器无 clipboard API 时静默跳过
    void navigator.clipboard?.writeText(commit.hash);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code>{commit.shortHash}</code>
        <Button data-testid="copy-hash" size="small" icon={<CopyOutlined />} onClick={copyHash} />
      </div>
      <div>{formatAuthorLine(commit.author, commit.dateIso)}</div>
      <div>
        <strong>{subject}</strong>
      </div>
      {branches.length > 0 ? (
        <div data-testid="branch-chips">
          {branches.map((b) => (
            <Tag key={b} color="blue">
              {b}
            </Tag>
          ))}
        </div>
      ) : null}
      {tags.length > 0 ? (
        <div data-testid="tag-chips">
          {tags.map((t) => (
            <Tag key={t} color="orange">
              {t}
            </Tag>
          ))}
        </div>
      ) : null}
      {commit.parents.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>父提交：</span>
          {commit.parents.map((p) => (
            <a key={p} data-testid="parent-link" href={`#${p}`}>
              {p.slice(0, 7)}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
