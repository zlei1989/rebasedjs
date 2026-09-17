/**
 * 提交详情面板：UX 对齐 #1 字段集（Java CommitDetailsPanel.kt:71-199）。
 * 短 hash + 复制按钮、作者、日期（"{author} on {date} at {time}"）、加粗 subject、
 * 分支/标签 chips（antd Tag 两组）、父提交链接。
 *
 * 完整提交信息：subject 之下补正文块（**只读文本**，保留原始换行；无正文时不渲染空块）。
 *   为什么正文不是可折叠/可编辑：面板是只读的信息面，折叠会让「这条提交到底说了什么」
 *   二次收费；改信息有专门的 Reword 入口（行右键）。
 *
 * 复制口径（用户口径：点文本即复制）——四处可复制目标，全部走 base/CopyOnClick：
 *   · 短 hash → 完整 40 位 hash（显示短、复制全，正是复制按钮存在的理由）；
 *   · 作者行   → `姓名 <邮箱>`（**不含时间戳**：时间不是可复制单元，剪贴板里混进时间就没法直接用）；
 *   · 分支 chip / 标签 chip → chip 原文（`HEAD -> ` 前缀已由 classifyRefs 剥离）。
 *
 * 操作按钮：浏览快照/查看变更集/摘樱桃/还原/Reset 当前分支到此处——均为可选回调注入，缺省不渲染；
 *   「浏览快照」与「查看变更集」都是**开关**：browseActive/changesActive 为真时按钮呈选中态，
 *   再点一次即收起（前者收快照栏、后者收变更集标签，均由容器实现）。
 */
import { Button, Flex, Tag, Tooltip, Typography } from 'antd';
import type { CSSProperties } from 'react';
import type { CommitInfo } from '@rebased/contracts';
import { classifyRefs } from './refs';
import { formatAuthor, formatAuthorTimestamp } from './format';
import { CopyOnClick } from '../base/copy-on-click';

const { Text, Title } = Typography;

export interface CommitDetailsPanelProps {
  commit: CommitInfo;
  /** 「Reset 当前分支到此处」回调（携带当前提交 hash）；缺省不渲染该按钮 */
  onResetHere?: (hash: string) => void;
  /** 「摘樱桃」回调（携带当前提交 hash）；缺省不渲染该按钮 */
  onCherryPick?: (hash: string) => void;
  /** 「还原」回调（携带当前提交 hash）；缺省不渲染该按钮 */
  onRevert?: (hash: string) => void;
  /** 「浏览快照」回调（携带当前提交 hash → 打开该提交的就地快照栏）；缺省不渲染该按钮 */
  onBrowse?: (hash: string) => void;
  /**
   * 浏览快照是否已展开：为真时该按钮呈主按钮选中态，提示语改为「再点一次收起」。
   * 缺省 false（未展开）——面板不持有展开态，真源在调用方（URL/容器）。
   */
  browseActive?: boolean;
  /** 「查看变更集」回调（#13：打开该提交的变更集标签——快照栏标签栏里的「变更集（N）」，再点一次即收起）；缺省不渲染该按钮 */
  onOpenChanges?: (hash: string) => void;
  /**
   * 变更集标签是否开着（且就是当前提交）：为真时该按钮呈主按钮选中态，提示语改为「再点一次收起」。
   * 与 browseActive 同一套口径——面板不持有开关态，真源在容器（changesHash）。
   */
  changesActive?: boolean;
  /** 父提交链接回调（携带父提交 hash）：注入后父提交短名渲染为可点链接并在提交图中选中它；
   *  缺省退化为 `#hash` 锚点（宿主未接选中链路时的兜底，不承诺跳转） */
  onSelectCommit?: (hash: string) => void;
  /** 根节点样式：调用方按所在栏/宿主的布局约束注入（如栏内 `minHeight: '100%'`）；缺省不落样式 */
  style?: CSSProperties;
  /** 根节点 testid（带连字符的属性名逐字写出，调用方才能直接传 `data-testid`；缺省不落该属性） */
  'data-testid'?: string;
}

export function CommitDetailsPanel({
  commit,
  onResetHere,
  onCherryPick,
  onRevert,
  onBrowse,
  browseActive = false,
  onOpenChanges,
  changesActive = false,
  onSelectCommit,
  style,
  'data-testid': dataTestId,
}: CommitDetailsPanelProps): React.ReactNode {
  const { branches, tags } = classifyRefs(commit.refs);
  // 提交信息拆分：首行为 subject（加粗展示），其余为正文。正文连同其后的空行一起裁掉尾部空白——
  // 多数提交在正文尾带一个空行，原样渲染会在面板底部留一段无意义的空白
  const [subject = '', ...rest] = commit.message.split('\n');
  const body = rest.join('\n').trim();
  /** chip 渲染：分支/标签各自可点复制（点 chip 原文写剪贴板），hover 由 CopyOnClick 叠一层底色 */
  const renderChips = (names: string[], color?: string): React.ReactNode =>
    names.map((name) => (
      <CopyOnClick key={name} text={name} hint="点击复制该引用名到剪贴板">
        <Tag data-testid={`copy-ref-${name}`} color={color} style={{ marginInlineEnd: 0 }}>
          {name}
        </Tag>
      </CopyOnClick>
    ));
  return (
    /* 内边距为 0（用户口径）：面板贴着自己那一栏的边缘，四周留白交给栏容器与各行的间距，
       面板自己再包一层 8px 会与栏的留白叠成双重缩进 */
    <Flex vertical gap={8} style={style} data-testid={dataTestId}>
      <CopyOnClick text={commit.message} hint="点击复制完整提交信息到剪贴板" plain>
        {/* 主题行：显示仍是加粗的 subject，复制值是**整条提交信息**（主题 + 正文）——
            粘进 PR / 提交信息框时要的就是完整版。
            加粗的 <Text strong> 放在 CopyOnClick **里面**：plain 模式渲染的是一根 span，
            反过来包（strong 在外）会让「主题」这段文本落在 span 上，加粗语义与文本就不再是同一个元素 */}
        <Text strong>{subject}</Text>
      </CopyOnClick>
      <Flex gap={8}>
        {/* 短 hash 本身即复制目标：点它写入**完整** hash（原专用复制按钮已由这一处取代，
            少一个并排的重复控件；键盘可达性不变——CopyOnClick 渲染的就是 button） */}
        <CopyOnClick text={commit.hash} hint="点击复制完整 hash 到剪贴板" plain mono data-testid="copy-hash">
          <Text type="secondary">{commit.shortHash}</Text>
        </CopyOnClick>

        {/* 作者行所在容器：作者（可复制）与时间戳合起来读就是 Java 那句「{author} on {date} at {time}」，
            故整行给一个 testid（两段节点不跨元素匹配，只有整行能断言这句格式） */}
        <Flex gap={8} data-testid="author-line">
          <CopyOnClick
            text={formatAuthor(commit.author, commit.authorEmail)}
            hint="点击复制作者（姓名 <邮箱>）到剪贴板"
            plain
            data-testid="copy-author"
          >
            <Text type="secondary">
              {commit.author}
              {` on ${formatAuthorTimestamp(commit.dateIso)}`}
            </Text>
          </CopyOnClick>
        </Flex>
      </Flex>
      {body === '' ? null : (
        <div>
          {/* 正文块：等宽 + 保留换行（逐行对齐的文本不折行显示），点它复制的同样是整条提交信息 */}
          <CopyOnClick text={commit.message} plain mono data-testid="commit-body">
            <div style={{whiteSpace: 'pre-wrap'}}>{body}</div>
          </CopyOnClick>
        </div>
      )}
      {branches.length > 0 ? <div data-testid="branch-chips">{renderChips(branches, 'blue')}</div> : null}
      {tags.length > 0 ? <div data-testid="tag-chips">{renderChips(tags, 'orange')}</div> : null}
      {commit.parents.length > 0 ? (
        <Flex align="center" gap={8}>
          <span>父提交：</span>
          {commit.parents.map((p) =>
            // 父提交链接：注入 onSelectCommit 时点击即在提交图中选中该父提交（未加载到列表里的父提交不产生选中态）；
            // 未注入时退化为 `#hash` 锚点——不承诺跳转，仅保留既有形态
            onSelectCommit ? (
              <Tooltip key={p} title="跳转到该父提交：在提交图中选中它（若它已在当前加载的提交里）">
                <Button
                  data-testid="parent-link"
                  type="link"
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => onSelectCommit(p)}
                >
                  {p.slice(0, 7)}
                </Button>
              </Tooltip>
            ) : (
              <Tooltip key={p} title="跳转到该父提交：按提交号重新定位提交图并选中它">
                <a data-testid="parent-link" href={`#${p}`}>
                  {p.slice(0, 7)}
                </a>
              </Tooltip>
            ),
          )}
        </Flex>
      ) : null}
      {/* 操作区：浏览快照/查看变更集/摘樱桃/还原/Reset 当前分支到此处——逐个按回调注入渲染（仅调用方注入回调时出现；确认弹窗与 hook 调用由容器持有） */}
      {onResetHere || onCherryPick || onRevert || onBrowse || onOpenChanges ? (
        <Flex gap={8} wrap>
          {onBrowse ? (
            <Tooltip title={browseActive ? '收起文件快照：把这一版的快照栏收起来' : '浏览该提交的文件快照：就地展开这一版的文件树（不改动工作区）'}>
              <Button
                data-testid="browse-snapshot"
                size="small"
                type={browseActive ? 'primary' : 'default'}
                onClick={() => onBrowse(commit.hash)}
              >
                浏览快照
              </Button>
            </Tooltip>
          ) : null}
          {onOpenChanges ? (
            <Tooltip
              title={
                changesActive
                  ? '收起变更集标签：本次提交的变更清单与逐个文件的差异标签一并关掉'
                  : '查看该提交的变更集：在快照栏里列出本次提交涉及的全部文件，可再点单个文件看差异'
              }
            >
              <Button
                data-testid="open-changes"
                size="small"
                type={changesActive ? 'primary' : 'default'}
                onClick={() => onOpenChanges(commit.hash)}
              >
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
        </Flex>
      ) : null}
    </Flex>
  );
}
