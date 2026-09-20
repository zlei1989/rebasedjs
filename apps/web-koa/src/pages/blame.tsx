/**
 * 溯源页容器（三栏工作台）：URL 真源（?file=&select=&view=，旧 ?rev= 只读兼容）+ 三栏取数装配
 * → ui BlameWorkbench（与 web-next 容器同构；repoId 取 useParams、导航用 useNavigate）。
 * 取数（全部既有端点，无新增）：左树 useBrowseTree(HEAD) / 中栏 useHistory(--follow) /
 * 选中提交变更集 useCommitFiles（父提交与三种降级判据的唯一来源，也供受影响弹窗同键缓存共享）/
 * 右栏三标签各按激活项条件拉取——非激活标签传空字符串挂 null key，不发请求（design §3.2）。
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
  const { data: entry, isLoading: entryLoading } = useCommitFiles(repoId, hash);
  const hints = changesHints(entry, hash, file);
  const parent = hints.ready ? entry?.parents[0] : undefined;
  // 右栏三标签：只拉当前激活的那一个（未激活传空串 → hook 挂 null key 不发请求）；
  // 走降级提示行的两种情形（重命名 / 该提交没有这个路径）**连请求都不发**——两侧都取不到内容，
  // 发出去只会拿回两个空文档（与「不给伪 diff」同一口径）
  const changesEnabled =
    view === 'changes' && file !== '' && parent !== undefined && hints.renameFrom === undefined && !hints.missingPath;
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
  const annotateEnabled = view === 'annotate' && file !== '' && hash !== '';
  const { data: lines, isLoading: linesLoading, error: linesError } = useBlame(
    repoId,
    annotateEnabled ? file : '',
    hash,
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
  /** 操作条「差异页」：新标签页打开（本页留在原处）；根提交无父版本 → root=1 只给提示行 */
  const openDiffPage = (target: string): void => {
    const path = encodeURIComponent(file);
    if (parent === undefined) openInNewTab(`/repos/${repoId}/diff?file=${path}&root=1`);
    else openInNewTab(`/repos/${repoId}/diff?file=${path}&from=${parent}&to=${target}`);
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
      {/* key=repoId：SPA 同挂载实例切换仓库时强制重挂载（三栏内部无会话态，语义对齐既有页面约定） */}
      <BlameWorkbench
        key={repoId}
        file={file}
        tree={{ entries: tree?.entries, loading: treeLoading, error: treeError?.message }}
        commits={{ entries: commits, loading: commitsLoading, error: commitsError?.message }}
        hash={hash}
        view={view}
        entry={entry}
        changes={{ versions: changesVersions, loading: changesLoading || (changesEnabled && entryLoading), error: changesError?.message }}
        latest={{ versions: latestVersions, loading: latestLoading, error: latestError?.message }}
        annotate={{ lines, loading: linesLoading, error: linesError?.message }}
        affected={{ hash: affectedHash, entry: affectedEntry, loading: affectedLoading, error: affectedError?.message ?? null }}
        onSelectFile={selectFile}
        onSelectCommit={(next) => write(withBlameSelection(searchParams, next))}
        onViewChange={(next) => write(withBlameView(searchParams, next))}
        onOpenCommit={(target) => navigate(`/repos/${repoId}?select=${target}`)}
        onOpenDiff={openDiffPage}
        onShowAffected={setAffectedHash}
        onCloseAffected={() => setAffectedHash('')}
        onOpenAffectedFile={openAffectedFile}
        onOpenInHistory={() => navigate(`/repos/${repoId}/history?file=${encodeURIComponent(file)}`)}
      />
    </PageShell>
  );
}
