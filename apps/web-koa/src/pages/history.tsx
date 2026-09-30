/**
 * 历史页容器（三栏工作台）：URL 真源（?file=&select=&view=，旧 ?rev= 只读兼容）+ 三栏取数装配
 * → ui HistoryWorkbench（与 web-next 容器同构；repoId 取 useParams、交互一律写地址）。
 * 取数（全部既有端点，无新增）：左树 useBrowseTree(HEAD) / 中栏 useFileHistory(--follow) /
 * 选中提交变更集 useCommitFiles（父提交与三种降级判据的唯一来源，也是「提交详情」标签的详情与清单来源）/
 * 右栏四标签各按激活项条件拉取——非激活标签传空字符串挂 null key，不发请求（design §3.2）/
 * 根提交的标签1 不用差异（没有父版本），改用 useBrowseContent 读该提交里的文件全文（只读代码视图）。
 * 「提交详情」标签本身**不发任何请求**：详情卡与变更清单都吃上面那份 useCommitFiles 的结果。
 * 「逐行注解」按地址里有没有显式 `?select=` 分两种口径：没有 → 看**当前工作区**（不给 rev，本地未提交的行
 * 哈希为全 0、不可点）；有（含旧 `?rev=` 规范化来的）→ 看那一版。差异两标签始终看选中提交那一版。
 * 注解行**整行是一个入口**（用户口径：只做点击、不做 hover、移入不高亮）：点行的任何位置 = 选中该行归属的提交
 * **+** 在该行哈希旁开/收提交详情浮层（浮层锚点仍是哈希，位置不因"整行可点"而变；数据复用 useCommitFiles，关着时挂 null key 不发请求）。
 * 唯一剩下的出口：「提交详情」标签里点变更清单的文件行 → 新标签页打开该文件的差异页（from=父&to=提交，
 * 根提交 root=1；父提交未知则不注入该回调）。原操作条的四个出口与受影响弹窗按用户口径整行删除——
 * 受影响的那份清单由「提交详情」标签就地承担（不再开浮层）。
 * 旧深链残键：`?rev=` 随历史页撤销而失去语义，规范化只删键、不再解释（见 url-select 的 normalizeBlameQuery）。
 */
import { useBlame, useBrowseContent, useBrowseTree, useCommitFiles, useFileDiff, useFileHistory } from '@rebased/client';
import { HistoryWorkbench, PageShell, RepoTopNav, changesHints, openInNewTab, resolveHistoryHash } from '@rebased/ui';
import { Button, Flex, Input, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useRepoNav } from '../repo-nav';
import {
  normalizeBlameQuery,
  readHistoryFile,
  readHistoryView,
  readSelect,
  withHistoryFile,
  withHistorySelection,
  withHistoryView,
} from '../url-select';

export function RepoHistoryPage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const nav = useRepoNav(repoId);
  const [searchParams, setSearchParams] = useSearchParams();
  /** 写地址一律 replace：选中/切标签/换文件都不产生新的浏览步骤，不该把浏览器历史塞满 */
  const write = (next: URLSearchParams): void => setSearchParams(next, { replace: true, preventScrollReset: true });
  // 旧 `?rev=` 一次性规范化（读到即改写；改写后地址里不再有 rev，条件自然不再成立）。
  // 这里直接调 setSearchParams 而不复用上面的 write：write 每次渲染都是新函数，当依赖项会让 effect 每帧重跑
  useEffect(() => {
    const normalized = normalizeBlameQuery(searchParams);
    if (normalized.toString() !== searchParams.toString()) {
      setSearchParams(normalized, { replace: true, preventScrollReset: true });
    }
  }, [searchParams, setSearchParams]);
  const file = readHistoryFile(searchParams);
  const view = readHistoryView(searchParams);
  const urlHash = readSelect(searchParams);
  // 输入框草稿：URL 的 file 变化（深链/前进后退/树里点文件）时跟随；只作编辑态，提交才写 URL
  const [draft, setDraft] = useState(file);
  useEffect(() => {
    setDraft(file);
  }, [repoId, file]);
  // 左栏：HEAD 目录树（固定版本，只做「选哪个文件」的导航）
  const { data: tree, isLoading: treeLoading, error: treeError } = useBrowseTree(repoId, 'HEAD');
  // 中栏：该文件的提交清单（--follow，最新在上）
  const { data: commits, isLoading: commitsLoading, error: commitsError } = useFileHistory(repoId, file);
  // 选中提交：URL 优先（陈旧深链也要能看），否则回落清单首条；都没有则空串（右栏空态、不发请求）
  const hash = resolveHistoryHash(urlHash, commits);
  // 选中提交的变更集：父提交 + 重命名/路径不存在的判据 + 「提交详情」标签的详情与清单（一份数据三处用）
  const { data: entry, isLoading: entryLoading, error: entryError } = useCommitFiles(repoId, hash);
  const hints = changesHints(entry, hash, file);
  // 父提交三态（不能只看「有没有父」——「未知」与「根提交」必须分开，否则取数那一拍会把有父提交误判成根提交）：
  //   · 变更集就绪 → 用它的 parents（权威来源：陈旧/被重写、不在中栏清单里的 hash 也准确）；
  //   · 未就绪但该 hash 在中栏清单里 → 用清单条目自带的同一个 %P 字段即时兜底
  //     （中栏与本页看的是同一份提交数据，只是到达时间不同）；
  //   · 两者都没有 → 未知，出口不猜。
  const listed = commits?.find((c) => c.hash === hash);
  const parents = hints.ready ? entry?.parents : listed?.parents;
  const parent = parents?.[0];
  // 右栏四标签：只拉当前激活的那一个（未激活传空串 → hook 挂 null key 不发请求）；
  // 走降级提示行的两种情形（重命名 / 该提交没有这个路径）**连请求都不发**——两侧都取不到内容，
  // 发出去只会拿回两个空文档（与「不给伪 diff」同一口径）。
  // 另显式要求 `hints.ready`：父提交现在可能是中栏兜底值，不能再拿「有父」代表变更集已就绪
  const changesEnabled =
    view === 'changes' && file !== '' && hints.ready && parent !== undefined && hints.renameFrom === undefined && !hints.missingPath;
  const { data: changesVersions, isLoading: changesLoading, error: changesError } = useFileDiff(
    repoId,
    changesEnabled ? file : '',
    false,
    parent,
    hash,
  );
  /**
   * 根提交的标签1（本文件改动）：没有父版本可比——差异请求照旧不发（上面的门禁卡在 `parent !== undefined` 上），
   * 但「该提交里的文件全文」是有的，而它正是这次提交新加入的全部内容，故改经既有 browse/content 端点读出来，
   * 交给右栏的只读代码视图（按路径推断语言 → 语法高亮）。
   * 门禁与右栏的降级判据是同一份（`hints.ready && hints.rootCommit`）：两个条件同时成立时右栏才走 rootCommitBody
   * 那一路，这里才发请求；未就绪时**不置位**（变更集还没到，不能凭上一提交下结论），挂 null key 不发请求。
   */
  const rootContentEnabled = view === 'changes' && file !== '' && hints.ready && hints.rootCommit;
  const { data: rootContent, isLoading: rootContentLoading, error: rootContentError } = useBrowseContent(
    repoId,
    rootContentEnabled ? hash : '',
    rootContentEnabled ? file : '',
  );
  const latestEnabled = view === 'latest' && file !== '' && hash !== '' && !hints.missingPath;
  const { data: latestVersions, isLoading: latestLoading, error: latestError } = useFileDiff(
    repoId,
    latestEnabled ? file : '',
    false,
    hash,
  );
  // 「逐行注解」的两种口径由**地址里有没有显式 `?select=`** 决定（不是由派生出来的 hash 决定）：
  //   · 有 `?select=`（含旧 `?rev=` 规范化来的）→ 看那一版的归属，rev 传选中哈希；
  //   · 没有 → 看**当前工作区**，**不给 rev**（`git blame <file>` 的工作区语义，本地未提交的行标「未提交」）。
  // 门禁也据此分叉：只有「显式选中」这一路要求 hash 非空——一次提交都没有的文件（中栏空清单）派生出的 hash
  // 是空串，但它的工作区内容照样能注解；反过来，没有显式选中时若卡在 hash !== '' 上，工作区注解就永远发不出去。
  // changes / latest 两标签的门禁与父提交三态解析**不受此影响**（它们看的一直是选中提交那一版）。
  const annotateRev = urlHash === null ? undefined : hash;
  const annotateEnabled = view === 'annotate' && file !== '' && (urlHash === null || hash !== '');
  const { data: lines, isLoading: linesLoading, error: linesError } = useBlame(
    repoId,
    annotateEnabled ? file : '',
    annotateRev,
  );
  /**
   * 注解行的哈希详情浮层（用户口径：只做点击，不做 hover）：点哈希 → 打开该提交的详情卡。
   * 数据源复用 useCommitFiles（与选中提交变更集同键共享缓存）：'' = 关着 → hook 挂 null key
   * **不发请求**；打开后按该哈希拉一次，SWR 缓存住，来回点不重复请求。
   * 作者邮箱取自注解行本身（BlameLine 有、CommittedEntry 没有）——同一提交在那一行就是这位作者。
   */
  const [detailHash, setDetailHash] = useState('');
  const { data: detailEntry, isLoading: detailLoading, error: detailError } = useCommitFiles(repoId, detailHash);
  // 换文件即收起浮层：它属于上一个文件的行，留着只会指向一个在新行表里不存在的哈希
  useEffect(() => {
    setDetailHash('');
  }, [file]);
  /** 换文件（左树点叶子 / 工具条提交）：写 file 并清掉 select（选中回落该文件最新一条） */
  const selectFile = (path: string): void => {
    write(withHistoryFile(searchParams, path));
  };
  /** 工具条提交：空白不触发（与树的叶子点击同一条路） */
  const submitDraft = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== '') selectFile(trimmed);
  };
  /**
   * 「提交详情」标签里点变更文件：新标签页打开该文件的差异页（本页留在原处）。
   * 两端与旧「受影响」弹窗的行点击**完全同口径**：有父 → `from=父&to=该提交`；确知是根提交 → `root=1`；
   * 变更集未就绪时不注入本回调（与按下条件同一条口径：宁可这一行不可点，也不打开一张说错话的页面）。
   */
  const openChangedFile = (path: string): void => {
    if (entry === undefined || entry === null) return;
    const encoded = encodeURIComponent(path);
    if (entry.parents.length === 0) openInNewTab(`/repos/${repoId}/diff?file=${encoded}&root=1`);
    else openInNewTab(`/repos/${repoId}/diff?file=${encoded}&from=${entry.parents[0]}&to=${entry.hash}`);
  };
  return (
    <PageShell gap={8}>
      {/* 仓库顶栏导航（共用组件）：current="history" 高亮「更多」按钮（历史在更多菜单内） */}
      <RepoTopNav {...nav} current="history" />
      <Flex gap={8}>
        <Tooltip title="输入文件路径（相对仓库根），回车查看历史">
          <Input
            data-testid="history-file-input"
            placeholder="输入文件路径（相对仓库根目录，如 src/main.ts）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={submitDraft}
          />
        </Tooltip>
        {/* 禁用态 antd 按钮不派发 hover：按 antd 做法包一层 span 承接提示，文案点明不可点的前提 */}
        <Tooltip title="按输入的文件路径查看该文件的历史（输入为空时此按钮不可点击）">
          <span>
            <Button type="primary" autoInsertSpace={false} disabled={draft.trim() === ''} onClick={submitDraft}>
              确定
            </Button>
          </span>
        </Tooltip>
      </Flex>
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载（三栏内部无会话态，语义对齐既有页面约定）。
          changes 通道的 error 带上变更集自身的取数失败：陈旧/被重写的 ?select= 父提交永远不到，
          不带上就会一直转圈，而服务端其实已经给了中文错误。
          「提交详情」标签点文件名的出口只在变更集就绪时注入（右栏契约：未注入回调则清单行不可点）——
          父提交未知时不猜：宁可这一行不可点，也不打开一张说错话的页面 */}
      <HistoryWorkbench
        key={repoId}
        file={file}
        tree={{ entries: tree?.entries, loading: treeLoading, error: treeError?.message }}
        commits={{ entries: commits, loading: commitsLoading, error: commitsError?.message }}
        hash={hash}
        view={view}
        entry={entry}
        entryState={{ loading: entryLoading, error: entryError?.message }}
        changes={{
          versions: changesVersions,
          loading: changesLoading,
          error: changesError?.message ?? (hints.ready ? undefined : entryError?.message),
        }}
        rootContent={{
          content: rootContent?.content,
          binary: rootContent?.binary,
          loading: rootContentLoading,
          error: rootContentError?.message,
        }}
        latest={{ versions: latestVersions, loading: latestLoading, error: latestError?.message }}
        annotate={{ lines, loading: linesLoading, error: linesError?.message }}
        detail={
          detailHash === ''
            ? null
            : {
              hash: detailHash,
              entry: detailEntry ?? null,
              authorEmail: lines?.find((line) => line.hash === detailHash)?.authorEmail ?? '',
              loading: detailLoading,
              ...(detailError === undefined ? {} : { error: detailError.message }),
            }
        }
        onToggleDetail={(next) => setDetailHash(next ?? '')}
        onSelectFile={selectFile}
        onSelectCommit={(next) => write(withHistorySelection(searchParams, next))}
        onViewChange={(next) => write(withHistoryView(searchParams, next))}
        {...(hints.ready ? { onOpenChangedFile: openChangedFile } : {})}
      />
    </PageShell>
  );
}
