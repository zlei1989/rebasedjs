/**
 * 溯源页容器（三栏工作台）：URL 真源（?file=&select=&view=，旧 ?rev= 只读兼容）+ 三栏取数装配
 * → ui BlameWorkbench（与 web-next 容器同构；repoId 取 useParams、导航用 useNavigate）。
 * 取数（全部既有端点，无新增）：左树 useBrowseTree(HEAD) / 中栏 useHistory(--follow) /
 * 选中提交变更集 useCommitFiles（父提交与三种降级判据的唯一来源，也供受影响弹窗同键缓存共享）/
 * 右栏三标签各按激活项条件拉取——非激活标签传空字符串挂 null key，不发请求（design §3.2）。
 * 「逐行注解」按地址里有没有显式 `?select=` 分两种口径：没有 → 看**当前工作区**（不给 rev，本地未提交的行
 * 标「未提交」）；有（含旧 `?rev=` 规范化来的）→ 看那一版。差异两标签始终看选中提交那一版。
 * 出口（选中提交级）：日志页定位 ?select= / 新标签页差异（from=父&to=提交，根提交 root=1）/
 * 受影响弹窗（清单行点击 → 该文件这次的差异）/ 文件历史页。
 * 旧深链兼容：`?rev=<hash>` 一次性规范化成 `select=<hash>&view=annotate`（历史页「Annotate」入口）。
 */
import { useBlame, useBrowseTree, useCommitFiles, useFileDiff, useHistory } from '@rebased/client';
import { BlameWorkbench, PageShell, RepoTopNav, changesHints, openInNewTab, resolveBlameHash } from '@rebased/ui';
import { Button, Flex, Input, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useRepoNav } from '../repo-nav';
import {
  normalizeBlameQuery,
  readBlameFile,
  readBlameView,
  readSelect,
  withBlameFile,
  withBlameSelection,
  withBlameView,
} from '../url-select';

export function RepoBlamePage(): React.ReactNode {
  const { repoId = '' } = useParams<{ repoId: string }>();
  const navigate = useNavigate();
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
  const file = readBlameFile(searchParams);
  const view = readBlameView(searchParams);
  const urlHash = readSelect(searchParams);
  // 输入框草稿：URL 的 file 变化（深链/前进后退/树里点文件）时跟随；只作编辑态，提交才写 URL
  const [draft, setDraft] = useState(file);
  useEffect(() => {
    setDraft(file);
  }, [repoId, file]);
  // 左栏：HEAD 目录树（固定版本，只做「选哪个文件」的导航）
  const { data: tree, isLoading: treeLoading, error: treeError } = useBrowseTree(repoId, 'HEAD');
  // 中栏：该文件的提交清单（--follow，最新在上）
  const { data: commits, isLoading: commitsLoading, error: commitsError } = useHistory(repoId, file);
  // 选中提交：URL 优先（陈旧深链也要能看），否则回落清单首条；都没有则空串（右栏空态、不发请求）
  const hash = resolveBlameHash(urlHash, commits);
  // 选中提交的变更集：父提交 + 重命名/路径不存在的判据 + 受影响弹窗的数据源（一份数据三处用）
  const { data: entry, error: entryError } = useCommitFiles(repoId, hash);
  const hints = changesHints(entry, hash, file);
  // 父提交三态（不能只看「有没有父」——「未知」与「根提交」必须分开，否则取数那一拍会把有父提交误判成根提交）：
  //   · 变更集就绪 → 用它的 parents（权威来源：陈旧/被重写、不在中栏清单里的 hash 也准确）；
  //   · 未就绪但该 hash 在中栏清单里 → 用清单条目自带的同一个 %P 字段即时兜底
  //     （中栏与本页看的是同一份提交数据，只是到达时间不同）；
  //   · 两者都没有 → 未知，出口不猜。
  const listed = commits?.find((c) => c.hash === hash);
  const parents = hints.ready ? entry?.parents : listed?.parents;
  const parent = parents?.[0];
  // 根提交判据同理取三态：就绪看变更集派生值，未就绪看清单条目；未知时**不置位**（否则又会把未知说成根提交）
  const rootCommit = hints.ready ? hints.rootCommit : listed !== undefined && listed.parents.length === 0;
  // 右栏三标签：只拉当前激活的那一个（未激活传空串 → hook 挂 null key 不发请求）；
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
  // 受影响弹窗（Show All Affected）：与上同键（同一提交）时缓存命中，不产生第二个请求
  const [affectedHash, setAffectedHash] = useState('');
  const { data: affectedEntry, isLoading: affectedLoading, error: affectedError } = useCommitFiles(repoId, affectedHash);
  /** 换文件（左树点叶子 / 工具条提交）：写 file 并清掉 select，同时收起受影响弹窗 */
  const selectFile = (path: string): void => {
    write(withBlameFile(searchParams, path));
    setAffectedHash('');
  };
  /** 工具条提交：空白不触发（与树的叶子点击同一条路） */
  const submitDraft = (): void => {
    const trimmed = draft.trim();
    if (trimmed !== '') selectFile(trimmed);
  };
  /**
   * 操作条「差异页」：新标签页打开（本页留在原处）。三态出口——
   * 有父 → `from=父&to=该提交`；确知是根提交 → `root=1`（差异页只给提示行）；
   * 父提交未知（变更集没到且该 hash 不在中栏清单里，如陈旧/被重写的 ?select= 深链）→ **什么都不做**，
   * 与按下条件不注入本回调同一条口径：宁可没有这个按钮，也不打开一张说错话的页面。
   */
  const openDiffPage = (target: string): void => {
    const path = encodeURIComponent(file);
    if (parent !== undefined) {
      openInNewTab(`/repos/${repoId}/diff?file=${path}&from=${parent}&to=${target}`);
      return;
    }
    if (rootCommit) openInNewTab(`/repos/${repoId}/diff?file=${path}&root=1`);
  };
  /** 受影响清单里点文件：该文件在这次提交里的差异（同样新标签页；根提交 → root=1） */
  const openAffectedFile = (path: string): void => {
    const affected = affectedEntry;
    if (affected === undefined || affected === null) return;
    const encoded = encodeURIComponent(path);
    if (affected.parents.length === 0) openInNewTab(`/repos/${repoId}/diff?file=${encoded}&root=1`);
    else openInNewTab(`/repos/${repoId}/diff?file=${encoded}&from=${affected.parents[0]}&to=${affected.hash}`);
  };
  return (
    <PageShell gap={8}>
      {/* 仓库顶栏导航（共用组件）：current="blame" 高亮「更多」按钮（溯源在更多菜单内） */}
      <RepoTopNav {...nav} current="blame" />
      <Flex gap={8}>
        <Tooltip title="输入文件路径（相对仓库根），回车查看溯源">
          <Input
            data-testid="blame-file-input"
            placeholder="输入文件路径（相对仓库根目录，如 src/main.ts）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={submitDraft}
          />
        </Tooltip>
        {/* 禁用态 antd 按钮不派发 hover：按 antd 做法包一层 span 承接提示，文案点明不可点的前提 */}
        <Tooltip title="按输入的文件路径溯源该文件（输入为空时此按钮不可点击）">
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
          「差异页」出口只在有父提交或确知根提交时注入（右栏契约：未注入回调就不渲染该按钮）——
          父提交未知时不猜：宁可没有这个按钮，也不打开一张说错话的页面 */}
      <BlameWorkbench
        key={repoId}
        file={file}
        tree={{ entries: tree?.entries, loading: treeLoading, error: treeError?.message }}
        commits={{ entries: commits, loading: commitsLoading, error: commitsError?.message }}
        hash={hash}
        view={view}
        entry={entry}
        changes={{
          versions: changesVersions,
          loading: changesLoading,
          error: changesError?.message ?? (hints.ready ? undefined : entryError?.message),
        }}
        latest={{ versions: latestVersions, loading: latestLoading, error: latestError?.message }}
        annotate={{ lines, loading: linesLoading, error: linesError?.message }}
        affected={{ hash: affectedHash, entry: affectedEntry, loading: affectedLoading, error: affectedError?.message ?? null }}
        onSelectFile={selectFile}
        onSelectCommit={(next) => write(withBlameSelection(searchParams, next))}
        onViewChange={(next) => write(withBlameView(searchParams, next))}
        onOpenCommit={(target) => navigate(`/repos/${repoId}?select=${target}`)}
        {...(parent !== undefined || rootCommit ? { onOpenDiff: openDiffPage } : {})}
        onShowAffected={setAffectedHash}
        onCloseAffected={() => setAffectedHash('')}
        onOpenAffectedFile={openAffectedFile}
        onOpenInHistory={() => navigate(`/repos/${repoId}/history?file=${encodeURIComponent(file)}`)}
      />
    </PageShell>
  );
}
