/**
 * 提交详情卡：溯源页注解行的哈希浮层内容（点击哈希后展示「其余信息」）。
 *
 * 为什么复用 domain/commit-details-panel 而不是另写一张卡：日志页详情面板已经承载了同一组字段与交互
 * ——主题加粗、正文块（保留换行）、作者 + 邮箱 + 时间、短哈希点击复制完整哈希、父提交链接——
 * 且已有既有测试守着；注解行浮层要的正是这套信息，另写一份必然与日志页逐字漂移。
 *
 * 两处补齐（都写在下面，不做静默猜测）：
 *   · `authorEmail` 取自**注解行**（BlameLine 有 authorEmail，CommittedEntry 没有）：同一提交在注解行里
 *     就署名那位作者，用它补全面板的「姓名 <邮箱>」复制口径；
 *   · `refs`/`graph` 注解场景没有（分支图列与分支/标签 chips 不渲染）——不算信息丢失：
 *     注解行本来也不展示引用，需要引用请走「日志定位」。
 *
 * 三态如实呈现：loading 转圈、error 红字（服务端中文文案原样透出）、两者都没有且无 entry 时不给空壳。
 */
import type { ReactNode } from 'react';
import { Spin, Typography } from 'antd';
import type { CommittedEntry, CommitInfo } from '@rebased/contracts';
import { CommitDetailsPanel } from '../domain/commit-details-panel';

export interface CommitDetailCardProps {
  /** 该提交的变更集条目（容器经 useCommitFiles 按哈希拉取）；message 字段即完整提交信息 */
  entry?: CommittedEntry | null;
  /** 注解行作者邮箱（浮层里补全「姓名 <邮箱>」） */
  authorEmail?: string;
  loading?: boolean;
  error?: string;
}

export function CommitDetailCard({ entry, authorEmail, loading, error }: CommitDetailCardProps): ReactNode {
  if (loading === true) return <Spin data-testid="blame-detail-loading" />;
  if (error !== undefined) {
    return (
      <Typography.Text type="danger" data-testid="blame-detail-error">
        {error}
      </Typography.Text>
    );
  }
  if (entry === undefined || entry === null) return null;
  const commit: CommitInfo = {
    hash: entry.hash,
    shortHash: entry.shortHash,
    message: entry.message,
    author: entry.author,
    authorEmail: authorEmail ?? '',
    dateIso: entry.dateIso,
    parents: entry.parents,
    refs: [],
    graph: '',
  };
  return (
    <div data-testid="commit-detail-card">
      <CommitDetailsPanel commit={commit} style={{ maxWidth: 420 }} />
      {/* 邮箱单列一行：面板本身只显示姓名（邮箱在它的「点击复制作者」载荷里），
          而行表已按用户口径去掉作者列——归属信息里邮箱要看得见，不能只藏在剪贴板 */}
      {authorEmail === undefined || authorEmail === '' ? null : (
        <Typography.Text type="secondary" data-testid="commit-detail-email" style={{ marginTop: 4 }}>
          {authorEmail}
        </Typography.Text>
      )}
    </div>
  );
}
