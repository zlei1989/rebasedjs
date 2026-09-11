/**
 * 提交详情面板：UX 对齐 #1 字段集（Java CommitDetailsPanel.kt:71-199）。
 * 短 hash + 复制按钮、作者、日期（"{author} on {date} at {time}"）、加粗 subject、
 * 分支/标签 chips（antd Tag 两组）、父提交链接。
 * 文件变更列表与签名状态不进（Java 面板内本来也没有）。
 * 操作按钮：摘樱桃/还原/Reset 当前分支到此处——均为可选回调注入，缺省不渲染对应按钮
 * （确认弹窗与 hook 调用由容器持有）。
 */
import { Button, Tag, Tooltip } from 'antd';
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
  /** 「查看变更集」回调（#13 LogPage → DiffPage 直达：打开该提交全量变更文件 Modal）；缺省不渲染该按钮 */
  onOpenChanges?: (hash: string) => void;
}

export function CommitDetailsPanel({
  commit,
  onResetHere,
  onCherryPick,
  onRevert,
  onBrowse,
  onOpenChanges,
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
        <Tooltip title="把该提交的完整 hash 复制到剪贴板（浏览器无剪贴板权限时静默跳过）">
          <Button data-testid="copy-hash" size="small" icon={<CopyOutlined />} onClick={copyHash} />
        </Tooltip>
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
            // 父提交链接：地址栏 hash 变化即由容器解析 ?select=<hash> 深链并切换选中提交
            <Tooltip key={p} title="跳转到该父提交：按提交号重新定位提交图并选中它">
              <a data-testid="parent-link" href={`#${p}`}>
                {p.slice(0, 7)}
              </a>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {/* 操作区：浏览快照/查看变更集/摘樱桃/还原/Reset 当前分支到此处——逐个按回调注入渲染（仅调用方注入回调时出现；确认弹窗与 hook 调用由容器持有） */}
      {onResetHere || onCherryPick || onRevert || onBrowse || onOpenChanges ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onBrowse ? (
            <Tooltip title="浏览该提交的文件快照：以只读方式打开这一版的目录内容（不改动工作区）">
              <Button data-testid="browse-snapshot" size="small" onClick={() => onBrowse(commit.hash)}>
                浏览快照
              </Button>
            </Tooltip>
          ) : null}
          {onOpenChanges ? (
            <Tooltip title="查看该提交的变更集：列出本次提交涉及的全部文件，可再点单个文件看差异">
              <Button data-testid="open-changes" size="small" onClick={() => onOpenChanges(commit.hash)}>
                查看变更集
              </Button>
            </Tooltip>
          ) : null}
          {onCherryPick ? (
            <Tooltip title="把该提交的改动移植到当前分支并生成一笔新提交（原提交保持不动）">
              <Button data-testid="cherry-pick" size="small" onClick={() => onCherryPick(commit.hash)}>
                摘樱桃
              </Button>
            </Tooltip>
          ) : null}
          {onRevert ? (
            <Tooltip title="生成一笔反向提交来抵消该提交的改动（历史保留，不做改写）">
              <Button data-testid="revert" size="small" onClick={() => onRevert(commit.hash)}>
                还原
              </Button>
            </Tooltip>
          ) : null}
          {onResetHere ? (
            <Tooltip title="把当前分支重置到该提交：此后的提交将不再属于本分支（需先确认重置方式）">
              <Button data-testid="reset-here" size="small" onClick={() => onResetHere(commit.hash)}>
                Reset 当前分支到此处
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
