/**
 * 提交详情面板：UX 对齐 #1 字段集（Java CommitDetailsPanel.kt:71-199）。
 * 短 hash + 复制按钮、作者、日期（"{author} on {date} at {time}"）、加粗 subject、
 * 分支/标签 chips（antd Tag 两组）、父提交链接。
 * 文件变更列表与签名状态不进（Java 面板内本来也没有）。
 * 操作按钮：摘樱桃/还原/Reset 当前分支到此处——均为可选回调注入，缺省不渲染对应按钮
 * （确认弹窗与 hook 调用由容器持有）。
 */
import { Button, Tag } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { CommitInfo } from '@rebased/contracts';
import { classifyRefs } from './refs';
import { formatAuthorLine } from './format';

export interface CommitDetailsPanelProps {
  commit: CommitInfo;
  /** 「Reset 当前分支到此处」回调（携带当前提交 hash）；缺省不渲染该按钮 */
  onResetHere?: (hash: string) => void;
  /** 「摘樱桃」回调（携带当前提交 hash）；缺省不渲染该按钮 */
  onCherryPick?: (hash: string) => void;
  /** 「还原」回调（携带当前提交 hash）；缺省不渲染该按钮 */
  onRevert?: (hash: string) => void;
  /** 「浏览快照」回调（携带当前提交 hash → /browse?rev=）；缺省不渲染该按钮 */
  onBrowse?: (hash: string) => void;
}

export function CommitDetailsPanel({
  commit,
  onResetHere,
  onCherryPick,
  onRevert,
  onBrowse,
}: CommitDetailsPanelProps): React.ReactNode {
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
      {/* 操作区：浏览快照/摘樱桃/还原/Reset 当前分支到此处——逐个按回调注入渲染（仅调用方注入回调时出现；确认弹窗与 hook 调用由容器持有） */}
      {onResetHere || onCherryPick || onRevert || onBrowse ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onBrowse ? (
            <Button data-testid="browse-snapshot" size="small" onClick={() => onBrowse(commit.hash)}>
              浏览快照
            </Button>
          ) : null}
          {onCherryPick ? (
            <Button data-testid="cherry-pick" size="small" onClick={() => onCherryPick(commit.hash)}>
              摘樱桃
            </Button>
          ) : null}
          {onRevert ? (
            <Button data-testid="revert" size="small" onClick={() => onRevert(commit.hash)}>
              还原
            </Button>
          ) : null}
          {onResetHere ? (
            <Button data-testid="reset-here" size="small" onClick={() => onResetHere(commit.hash)}>
              Reset 当前分支到此处
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
