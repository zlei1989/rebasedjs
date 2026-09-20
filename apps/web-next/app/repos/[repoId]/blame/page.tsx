'use client';

/**
 * 溯源页容器（三栏工作台）：与 web-koa 容器**同构**（同一份 URL 真源 `?file=&select=&view=`、同五个 hook、
 * 同一批出口语义与降级判据），差异只在 Next 专有的**三处机制**与**三项平台写法**：
 * 机制① 写地址用原生 `history.replaceState` 而不是 `router.replace`——后者是一次 soft navigation，
 *   每次点击都要往服务端取一次 RSC 载荷（实测 322ms 才落到地址栏），原生写法由 Next 的 History API 集成
 *   同步进 useSearchParams，无网络往返（与 app/repos/[repoId]/page.tsx 的既有口径一致）；
 * 机制② `useSearchParams` 要等下一次导航才同步，故文件/右栏标签/选中提交三份**本地镜像**负责点击后的即时反馈；
 * 机制③ 旧 `?rev=` 规范化并进「挂载即跑」的同步 effect（koa 那边是独立 effect）。
 * 平台写法：真导航用 `router.push`、不再用 `searchParams` prop、`liveQuery()` 只作**写地址的底本**。
 * 镜像初值取**确定性空值**（''/'changes'/null）而**不是**读地址栏，理由只有一条：`liveQuery()` 在服务端
 * 预渲染时恒为空参数，初值一旦读它，SSR 那一帧（无 window）与客户端 hydration 首帧（有 window）就会渲染出
 * 不同 HTML → React 报 `Hydration failed`（控制者实测：`:3091` 硬加载 `?file=AGENT.md`，受控 `Input` 的
 * `disabled` 与三栏子树两侧都不一致）。水合一致性优先于「首帧就带内容」：深链交给下面那条**无条件**
 * 同步 effect 从地址栏补齐，最终仍落到同一视图。
 * 取数（全部既有端点，无新增）：左树 useBrowseTree(HEAD) / 中栏 useHistory(--follow) /
 * 选中提交变更集 useCommitFiles（父提交与三种降级判据的唯一来源，也供受影响弹窗同键缓存共享）/
 * 右栏三标签各按激活项条件拉取——非激活标签传空字符串挂 null key，不发请求（design §3.2）。
 * 出口（选中提交级）：日志页定位 `?select=`（`router.push`，这一步是真导航）/ 新标签页差异
 * （from=父&to=提交，根提交 root=1，父提交未知则不注入该回调）/ 受影响弹窗（清单行点击 → 该文件这次的差异）/
 * 文件历史页。
 * 旧深链兼容：`?rev=<hash>` 一次性规范化成 `select=<hash>&view=annotate`（历史页「Annotate」入口）。
 */
import { useBlame, useBrowseTree, useCommitFiles, useFileDiff, useHistory } from '@rebased/client';
import {
  BlameWorkbench,
  PageShell,
  RepoTopNav,
  changesHints,
  openInNewTab,
  resolveBlameHash,
  type BlameViewKey,
} from '@rebased/ui';
import { Button, Flex, Input, Tooltip } from 'antd';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { use, useEffect, useState } from 'react';
import { useRepoNav } from '../../../../src/repo-nav';
import {
  normalizeBlameQuery,
  readBlameFile,
  readBlameView,
  readSelect,
  withBlameFile,
  withBlameSelection,
  withBlameView,
} from '../../../../src/url-select';

/**
 * **当前地址栏**的查询串，只作**写地址的底本**：`useSearchParams` 在 replaceState 之后仍是旧值，
 * 拿它作底本会把刚改写掉的参数抄回来。读界面状态那一路（首帧深链/前进后退）由下面无条件跑的同步 effect
 * 从本函数取真值。放在模块级（而不是组件体内）是为了让 effect 与写路径共用同一份读数——
 * 组件体内声明会撞上暂时性死区。服务端预渲染时没有 window：给空串，此时无人读它
 * （首帧镜像取确定性空值，不读地址栏——见文件头的水合一致性说明）。
 */
const liveQuery = (): URLSearchParams =>
  typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

/** 三份镜像（file/view/urlHash）的写入器：两个写路径据此落值，省得各写一遍 setState 四连 */
interface QueryMirrors {
  file: (value: string) => void;
  view: (value: BlameViewKey) => void;
  hash: (value: string | null) => void;
}

/** 地址 → 镜像：把一份查询串里的三个真源值抄进三份镜像（**不动地址**，供反向同步用） */
function adoptQuery(next: URLSearchParams, set: QueryMirrors): void {
  set.file(readBlameFile(next));
  set.view(readBlameView(next));
  set.hash(readSelect(next));
}

/**
 * 唯一的写地址出口：抄镜像 + `replaceState`（两者必须成对——漏抄一处，镜像就与地址漂开）。
 * 为什么 effect 里不直接调容器内的 `write`：`write` 每次渲染都是新函数，当依赖项会让 effect 每帧重跑
 * （koa 那边为同一件事把规范化那条路单独写了一遍）；更要紧的是 effect 的**首件事**是「地址 → 镜像」的
 * 只读同步，不能顺手把当前地址原样再写一遍——那会在 replaceState → currentQuery → effect 之间自激。
 */
function applyQuery(next: URLSearchParams, pathname: string, set: QueryMirrors): void {
  adoptQuery(next, set);
  const qs = next.toString();
  window.history.replaceState(null, '', qs === '' ? pathname : `${pathname}?${qs}`);
}

export default function Page({ params }: { params: Promise<{ repoId: string }> }): React.ReactNode {
  const { repoId } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const nav = useRepoNav(repoId);
  const currentQuery = useSearchParams();
  // 三份本地镜像（见文件头机制②）：初值一律**确定性空值**——SSR 与客户端 hydration 首帧必须由构造保证
  // 一致（不得出现任何读 window / 读地址栏的分支），深链与前进后退由下面无条件跑的同步 effect 补齐；
  // 写地址时同步更新
  const [file, setFile] = useState<string>('');
  const [view, setView] = useState<BlameViewKey>('changes');
  const [urlHash, setUrlHash] = useState<string | null>(null);
  /** 写地址：replaceState（不产生浏览步骤，也不该把浏览器历史塞满）+ 同步三份镜像；底本一律取当前地址栏 */
  const write = (next: URLSearchParams): void =>
    applyQuery(next, pathname, { file: setFile, view: setView, hash: setUrlHash });
  // 地址 → 镜像的反向同步：首帧深链、浏览器前进/后退、外部改地址（依赖 currentQuery 变化触发；
  // 写地址那一路已把镜像推到新值，同值 setState 是 no-op，不会互相打架）。
  // 底本用 liveQuery 而不是 currentQuery：水合那一拍 useSearchParams 可能还是空的，而地址栏早就是真值。
  useEffect(() => {
    const effective = liveQuery();
    const set: QueryMirrors = { file: setFile, view: setView, hash: setUrlHash };
    adoptQuery(effective, set);
    // 旧 `?rev=` 一次性规范化（读到即改写；改写后地址里不再有 rev，条件自然不再成立——写地址那一路不走这里，
    // 故不存在与新形态互写；应用自己也不再写出 rev）
    const normalized = normalizeBlameQuery(effective);
    if (normalized.toString() !== effective.toString()) applyQuery(normalized, pathname, set);
  }, [currentQuery, repoId, pathname]);
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
  const annotateEnabled = view === 'annotate' && file !== '' && hash !== '';
  const { data: lines, isLoading: linesLoading, error: linesError } = useBlame(repoId, annotateEnabled ? file : '', hash);
  // 受影响弹窗（Show All Affected）：与上同键（同一提交）时缓存命中，不产生第二个请求
  const [affectedHash, setAffectedHash] = useState('');
  const { data: affectedEntry, isLoading: affectedLoading, error: affectedError } = useCommitFiles(repoId, affectedHash);
  /** 换文件（左树点叶子 / 工具条提交）：写 file 并清掉 select，同时收起受影响弹窗 */
  const selectFile = (path: string): void => {
    write(withBlameFile(liveQuery(), path));
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
        onSelectCommit={(next) => write(withBlameSelection(liveQuery(), next))}
        onViewChange={(next) => write(withBlameView(liveQuery(), next))}
        onOpenCommit={(target) => router.push(`/repos/${repoId}?select=${target}`)}
        {...(parent !== undefined || rootCommit ? { onOpenDiff: openDiffPage } : {})}
        onShowAffected={setAffectedHash}
        onCloseAffected={() => setAffectedHash('')}
        onOpenAffectedFile={openAffectedFile}
        onOpenInHistory={() => router.push(`/repos/${repoId}/history?file=${encodeURIComponent(file)}`)}
      />
    </PageShell>
  );
}
