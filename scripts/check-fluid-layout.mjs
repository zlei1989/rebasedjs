#!/usr/bin/env node
/**
 * 六档横向溢出验收脚本（Task 16 的核心交付物）。
 *
 * 做什么：
 *   用真实浏览器（Playwright）在 360 / 480 / 768 / 1024 / 1440 / 1920 六档视口、明暗两主题下，
 *   逐格访问两个 app 的全部路由，以及「静态路由加载不会产生」的状态（GitHub/GitLab 展开差异、
 *   认证弹窗、重置弹窗、EllipsisText 悬停浮层），逐格断言页面级横向溢出为 0：
 *
 *     document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1   // +1 容亚像素
 *
 *   并断言两条**允许的例外**（防止后续有人把它们当缺陷「修掉」）：
 *     1) browse / log 页在 collapseBelow 以下两栏纵向堆叠（各占满可用宽度），以上则左右并排；
 *     2) Monaco 容器**内部**允许横向滚动（拖动它自己的横向滚动条，内容真的移动），
 *        而页面级断言仍为 0 —— 这条把「组件内允许横向滚动」变成可执行断言而非注释。
 *
 * 怎么用：
 *   node scripts/check-fluid-layout.mjs                        # 默认 web-next(3030)、六档 × 明暗
 *   node scripts/check-fluid-layout.mjs --app=koa --widths=360,768
 *   node scripts/check-fluid-layout.mjs --shots                # 断言后另出截图到 docs/shots/
 *   node scripts/check-fluid-layout.mjs --shots-only
 *   node scripts/check-fluid-layout.mjs --json=out.json --matrix=out.md
 *
 * 前置条件（本脚本不自起服务）：
 *   pnpm dev                                  → web-next :3030 / web-koa API :3031
 *   pnpm --filter @rebased/web-koa dev:web     → web-koa SPA :5173
 *   另需一个已注册的真实夹具仓库（默认 rebased-smoke，用 --repo 改）。
 *
 * 注意：
 *   - 每格的就绪是**两段式**：`ready`（页面壳 / 工具行出现）+ `content`（数据级条目真的渲染出来）。
 *     只等 `ready` 会量到「数据还没到」的页面，而空页永远不会横向溢出 —— 那样的绿什么都没证明，
 *     所以带 `content` 的格子在该选择器一条都没命中时**直接判红**（而不是静静地绿过去）；
 *     命中数还有下限 `min`（部分加载的页面同样不算通过，见 routeCells 顶部注释）。
 *   - 就绪门与主题门必须**串联**（`prepareCell`）：主题探针迟迟不落时会整页重载一次，
 *     重载后必须重跑该格的就绪门再测量 —— 否则会量到「刚重载、数据还没到」的空页并判绿。
 *   - 每格的判定现在是**三条**：① 页面级横向溢出为 0；② 该格文本的**主导基准字号**等于该路由的
 *     密度归属（compact 12px / 设置页 14px，见 assertDensity）—— 这两条都参与判定、都不重试；
 *     ③ 与格相关的例外断言（两栏堆叠 / Monaco 内部滚动 / EllipsisText 浮层）。
 *     为什么要有 ②：`/merge` 曾整条路由没有密度归属（以 antd 默认 14px 渲染），而当时 576 格
 *     溢出矩阵**全绿** —— 溢出为 0 与密度正确是两件独立的事。
 *   - 页面 JS 异常分两栏记录：真异常 + 已按判据过滤的良性噪声（Monaco 的 diff worker 被取消，
 *     见 classifyPageError）。判据按 stack 而不是按消息文本，避免把真缺陷一起过滤掉。
 *   - 主题是**服务端持久化设置**（PUT /api/settings）：脚本先读原值、跑完恢复，不留痕。
 *   - GitHub/GitLab 面板需要真实令牌，本检出没有：用 page.route 打桩**宿主 API 数据**，
 *     断言落到的仍是真实组件（GitHubPanel/GitLabPanel/HunkDiffView/Monaco）与真实 DOM。
 *   - 本脚本只读夹具仓库（全部走 app 的只读 GET）；唯一「会写」的交互（推送）被打桩为
 *     401 AUTH_FAILED，不会真的 push，也不会改夹具仓库。
 *   - Playwright 不在仓库依赖里时会去全局安装（@playwright/mcp 自带的 playwright）找，
 *     并可用 FLUID_PLAYWRIGHT / FLUID_CHROMIUM 指定；找不到就明确报错，不做降级替代。
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- 选项

/** 应用配置：两个 app 路由形状一致，只有端口与主题能力不同 */
const APPS = {
  next: { base: 'http://localhost:3030', themes: ['dark', 'light'], label: 'web-next' },
  // web-koa SPA 固定暗色（main.tsx: DensityProvider mode="dark"），故只有一档主题
  koa: { base: 'http://localhost:5173', themes: ['dark'], label: 'web-koa' },
};

const FLAGS = new Set(['shots', 'shots-only', 'headed', 'no-states', 'help']);

/** 极简参数解析：--k=v 或 --k v；布尔开关只认 FLAGS 里的名字（不会吞掉下一个参数） */
function parseArgs(argv) {
  const opts = {
    app: 'next',
    base: null,
    repo: 'rebased-smoke',
    widths: [360, 480, 768, 1024, 1440, 1920],
    themes: null,
    only: null,
    json: null,
    matrix: null,
    timeout: 25000,
    shots: false,
    shotsOnly: false,
    headed: false,
    states: true,
    label: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    const key = token.slice(2, eq === -1 ? undefined : eq);
    if (FLAGS.has(key)) {
      if (key === 'shots') opts.shots = true;
      if (key === 'shots-only') opts.shotsOnly = true;
      if (key === 'headed') opts.headed = true;
      if (key === 'no-states') opts.states = false;
      if (key === 'help') {
        console.log('用法见 scripts/check-fluid-layout.mjs 文件头');
        process.exit(0);
      }
      continue;
    }
    const value = eq === -1 ? argv[(i += 1)] : token.slice(eq + 1);
    if (key === 'app') opts.app = value;
    if (key === 'base') opts.base = value;
    if (key === 'repo') opts.repo = value;
    if (key === 'widths') opts.widths = String(value).split(',').map(Number).filter((n) => n > 0);
    if (key === 'themes') opts.themes = String(value).split(',').filter(Boolean);
    if (key === 'only') opts.only = String(value).split(',').filter(Boolean);
    if (key === 'pages') opts.pages = String(value).split(',').filter(Boolean);
    if (key === 'json') opts.json = value;
    if (key === 'matrix') opts.matrix = value;
    if (key === 'timeout') opts.timeout = Number(value);
  }
  const app = APPS[opts.app] ?? APPS.next;
  opts.base = opts.base ?? app.base;
  opts.themes = opts.themes ?? app.themes;
  opts.label = app.label;
  return opts;
}

// ---------------------------------------------------------------- Playwright 与浏览器

/** 逐个候选位置找 playwright；找不到就抛错并列出试过的路径（不静默降级为别的方案） */
function loadPlaywright() {
  const tried = [];
  try {
    return { module: createRequire(import.meta.url)('playwright'), from: 'repo dependency' };
  } catch {
    tried.push('repo dependency');
  }
  const binDir = dirname(process.execPath);
  const candidates = [
    process.env.FLUID_PLAYWRIGHT,
    join(binDir, 'node_modules', '@playwright', 'mcp'),
    join(binDir, '..', 'lib', 'node_modules', '@playwright', 'mcp'),
    join(binDir, 'node_modules', '@playwright', 'mcp', 'node_modules'),
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@playwright', 'mcp'),
  ].filter((p) => typeof p === 'string' && p !== '');
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    tried.push(dir);
    try {
      const mod = createRequire(join(dir, 'index.js'))('playwright');
      if (mod?.chromium !== undefined) return { module: mod, from: dir };
    } catch {
      // 该候选不可用，继续找
    }
  }
  throw new Error(
    `找不到 playwright。试过：\n  - ${tried.join('\n  - ')}\n` +
      '请 `pnpm add -D playwright`，或用 FLUID_PLAYWRIGHT=<含 playwright 的目录> 指定。',
  );
}

/** 找 chromium 可执行文件：优先 FLUID_CHROMIUM，其次扫描 ms-playwright 缓存里版本号最高的 */
function findChromium() {
  if (process.env.FLUID_CHROMIUM !== undefined && existsSync(process.env.FLUID_CHROMIUM)) {
    return process.env.FLUID_CHROMIUM;
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'),
  ].filter((p) => typeof p === 'string' && p !== '');
  const rels = [
    join('chrome-win64', 'chrome.exe'),
    join('chrome-win', 'chrome.exe'),
    join('chrome-linux64', 'chrome'),
    join('chrome-linux', 'chrome'),
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const version = /^chromium-(\d+)$/.exec(entry);
      if (version === null) continue;
      for (const rel of rels) {
        const exe = join(root, entry, rel);
        if (existsSync(exe)) found.push({ version: Number(version[1]), exe });
      }
    }
  }
  if (found.length === 0) return null;
  return found.sort((a, b) => b.version - a.version)[0].exe;
}

// ---------------------------------------------------------------- HTTP 助手

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function putJson(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------- SplitPane 的 collapseBelow

/**
 * 从 split-pane.tsx 源码读 collapseBelow 的当前默认值。
 * 为什么读源码而不是抄常量：本脚本要断言的正是「默认值行为」，抄一份常量就会出现
 * 「改了原语、脚本还在按旧阈值判定」的假绿。
 * 为什么读不到就**报错**而不是回落 768：静默回落恰好会重新引入它要防的那种假绿 ——
 * 默认值一旦改成非字面量（如 `collapseBelow = DEFAULT_COLLAPSE_BELOW`、`= 768 * 1`），
 * 正则失配，脚本会拿一个与实现无关的旧阈值去判定例外①，且不会有任何提示。
 */
function readCollapseBelow() {
  const file = join(ROOT, 'packages', 'client', 'ui', 'src', 'base', 'split-pane.tsx');
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`读不到 ${file}（例外①要按它的当前默认值判定，不能猜）：${error instanceof Error ? error.message : String(error)}`);
  }
  const match = /collapseBelow\s*=\s*(\d+)/.exec(src);
  if (match === null) {
    throw new Error(
      `${file} 里匹配不到 collapseBelow 的字面量默认值（正则 /collapseBelow\\s*=\\s*(\\d+)/）。\n` +
        '默认值若改成了非常量写法，请同步更新本脚本的读取方式；**不回落任何缺省值**——按旧阈值判定等于假绿。',
    );
  }
  return Number(match[1]);
}

// ---------------------------------------------------------------- 夹具上下文

/**
 * 取夹具仓库与真实 git 数据：路由要渲染真实数据，空态下的断言没有意义。
 * hash / branch / file 都从 app 自己的只读端点取，不硬编码（换仓库仍可用）。
 */
async function loadFixture(base, repoName) {
  const raw = await getJson(`${base}/api/repos`);
  const list = raw.repos ?? raw;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${base}/api/repos 里没有已注册仓库：请先在 UI 打开一个既有夹具仓库（勿跑 scripts/smoke-setup.ps1）`);
  }
  const repo = list.find((r) => r.name === repoName) ?? list[0];
  const log = await getJson(`${base}/api/repos/${repo.id}/log?limit=60`);
  const commits = log.commits ?? [];
  if (commits.length === 0) throw new Error(`仓库 ${repo.name} 没有提交，无法渲染日志页`);
  const hash = commits[0].hash;
  const prevHash = commits[1]?.hash ?? hash;
  // 最长 subject 的提交：重置弹窗里 EllipsisText 渲染 `${shortHash} ${message}`，
  // 取最长的那个才有稳定的溢出余量（antd 只在真溢出时才弹 tooltip）
  const longest = [...commits].sort((a, b) => b.message.length - a.message.length)[0];
  const branchesRaw = await getJson(`${base}/api/repos/${repo.id}/branches`);
  const locals = (branchesRaw.local ?? branchesRaw.branches ?? []).map((b) => b.name ?? b);
  const branch = locals.includes('master') ? 'master' : (locals[0] ?? 'master');
  // 差异页要一个真实存在的文件：先问 browse 端点，缺省值不在该版本就退回首个小文本文件
  let file = 'src/app.ts';
  try {
    const tree = await getJson(`${base}/api/repos/${repo.id}/browse?rev=${hash}`);
    const blobs = (tree.entries ?? []).filter((e) => e.type === 'blob');
    if (!blobs.some((e) => e.path === file)) {
      const fallback = blobs.find((e) => /\.(ts|tsx|js|jsx|md|json|txt|css|html)$/.test(e.path)) ?? blobs[0];
      file = fallback?.path ?? file;
    }
  } catch {
    // browse 端点不可用（空仓等）：保留缺省值，差异页会自行呈现 error 态，断言仍然有效
  }
  return { repo, commits, hash, prevHash, longest, branch, file };
}

// ---------------------------------------------------------------- 页面内断言

const OVERFLOW_TOLERANCE = 1;

/**
 * 页面 JS 异常的分类判据。`benign` = 记录进产物但**不参与判定**、且从「异常」清单里剔除的噪声。
 *
 * 唯一的良性判据（实测证据，不是猜测）：**Monaco 的 diff worker 被取消**。
 * 复现方式：直接打开 diff 页（不切主题、不重载、不做任何额外操作），3/3 次都抛出一条 `Canceled`，stack 为
 *   Canceled: Canceled
 *     at canceled (monaco-editor/esm/vs/base/common/errors.js)
 *     at EditorWorkerClient.workerWithSyncedResources
 *     at StandaloneEditorWorkerService.computeDiff
 *     at async WorkerBasedDocumentDiffProvider.computeDiff
 * 即：Monaco 走 worker 计算差异时，前一次未完成的请求被它自己 cancel 掉，该取消以未处理拒绝的形式
 * 冒到 window 上。同一导航里 diff 完全正常（编辑器、`.view-lines`、横向滚动条的几何都对，例外② 的
 * 拖动断言通过），所以它是**有意的取消**，不是页面缺陷，也不是「主题重载打断了 fetch」
 * （重载不是必要条件：上述复现里根本没有重载）。
 * 为什么按 stack 判而不是按消息文本判：`Canceled` 这三个字太泛，按消息过滤等于把「任何叫 Canceled
 * 的异常」都放过去 —— 那条通道正是「用过滤掩盖真缺陷」的典型写法，本脚本不接受。
 */
const BENIGN_PAGE_ERROR_RULE = 'name === "Canceled" 且 stack 指向 monaco-editor 的 computeDiff（Monaco 的 diff worker 被取消）';

function classifyPageError(error) {
  const stack = typeof error.stack === 'string' ? error.stack : '';
  if ((error.name ?? '') === 'Canceled' && /monaco-editor/.test(stack) && /computeDiff/.test(stack)) return 'benign';
  return 'error';
}

/** 取文档滚动量 + 主题探针 + 越界元素（失败时用于定位，不只报「红了」） */
function measureInPage() {
  const de = document.documentElement;
  const clientWidth = de.clientWidth;
  const background = getComputedStyle(document.body).backgroundColor;
  const rgb = /(\d+),\s*(\d+),\s*(\d+)/.exec(background);
  const luma = rgb === null ? null : (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000;
  // 越界元素：右边缘超出视口，且自身不是滚动容器（滚动容器只是受害者，顶宽父级的是它的内容）
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= clientWidth + 1) continue;
    const style = getComputedStyle(el);
    if (style.position === 'fixed') continue;
    let depth = 0;
    for (let p = el; p !== null; p = p.parentElement) depth += 1;
    offenders.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 60),
      testid: el.getAttribute('data-testid'),
      text: (el.textContent ?? '').trim().slice(0, 40),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      depth,
    });
  }
  offenders.sort((a, b) => b.depth - a.depth);
  return {
    scrollWidth: de.scrollWidth,
    clientWidth,
    datasetTheme: de.dataset.theme ?? null,
    bodyBackground: background,
    isDark: luma === null ? null : luma < 128,
    offenders: offenders.slice(0, 5),
  };
}

/**
 * 页面级**密度**取样（按路由的密度断言用，见 assertDensity）。
 *
 * 取什么：排除 `.monaco-editor` 子树后，所有「可见 + 自带非空文本节点」的元素的 computed fontSize
 * 直方图，并单独数出 12px（compact 基准）与 14px（antd 默认基准）两种节点的个数。
 *
 * 为什么用「主导字号」而不是逐路由手挑一个节点：26 条路由 × 2 app 手挑选择器既脆又难维护，
 * 而本断言要抓的正是「整页落回另一档基准字号」这件事 —— 它在**全页文本上**表现为众数，逐路由
 * 手挑一个节点反而可能在改名/改文案后静默失效。取样数、直方图与两档计数都写进产物，可复核。
 *
 * 为什么排除 Monaco：编辑器字号由 Monaco 自己的配置决定（实测 14px，与 antd 密度无关），
 * 属**组件内部**例外（同「Monaco 内部可横向滚动」那条例外）；不排除会让 diff 页恒以 14px 主导而误红。
 *
 * 为什么覆盖 portal：Modal 经 createPortal 渲染到 body，而 React context 穿过 portal ——
 * `/merge` 这类「整页只有一个 Modal、背后文档为空」的路由，唯一可测的文本就在弹窗里，
 * 而这次修的正是「同一弹窗从 /merge 进是 14px、从 /conflicts 进是 12px」。
 */
function measureDensityInPage() {
  const hist = {};
  let sampled = 0;
  let monacoSkipped = 0;
  let count12 = 0;
  let count14 = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.monaco-editor') !== null) {
      monacoSkipped += 1;
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (own === '') continue;
    const fontSize = getComputedStyle(el).fontSize;
    hist[fontSize] = (hist[fontSize] ?? 0) + 1;
    sampled += 1;
    if (fontSize === '12px') count12 += 1;
    if (fontSize === '14px') count14 += 1;
  }
  const ranked = Object.entries(hist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([size, count]) => `${size}×${count}`);
  return { count12, count14, sampled, monacoSkipped, hist: ranked };
}

/**
 * 按路由的**密度断言**（本轮新增）：本格页面文本的主导基准字号必须等于该路由的密度归属。
 *
 * 期望值：默认 **12px**（`PageShell` 不传 `density` ⇒ compact）；设置页路由 **14px**
 * （`density="default"` 豁免，antd 默认基准）。判据是**主导**（12px 与 14px 谁是众数），
 * 不是「出现了 12px」—— 后者在两档下都可能成立（compact 页仍有 14px 的卡片标题，
 * 默认档页也有 12px 的次要文本），没有判别力。
 *
 * 三态：
 *   - pass：期望档的计数严格多于另一档；
 *   - fail：另一档更多，或两档计数相同（无法判定主导 ⇒ 判红，不掷硬币）；
 *     失败原因里带上两档计数、取样数与直方图，读者不必再跑一次才知道差在哪。
 *   - no-sample：`.monaco-editor` 之外**一个 12px/14px 文本节点都没有**（有界重采之后仍是如此）。
 *     这种情况不判红（没有密度可言），但会被**逐格列进汇总**，不允许静默跳过。
 */

/** no-sample 之前的有界重采上限（只在「一个 12px/14px 文本节点都没有」时才会用满） */
const DENSITY_SAMPLE_WAIT = 5000;

async function assertDensity(page, cell, expected) {
  let m = await page.evaluate(measureDensityInPage);
  // **有界重采（只在这一种情形下等）**：实测见过 3 格（`dark/768 blame`、`dark/1440 search`、
  // `light/1024 blame`）在一个 **antd 样式尚未注入**的瞬间被采样 —— 直方图全是浏览器默认的
  // `16px` / `13.3333px`，一个 12/14 节点都没有。那不是「该路由没有文本可测」，而是「还没上样式」，
  // 直接记 no-sample 等于把一次真实的密度断言让给运气。故：**只在两档计数都为 0 时**有界轮询
  // （有样本时零等待，不拖慢正常格），等到出现 12/14 节点就重采一次；等满仍未出现才记 no-sample。
  const started = Date.now();
  while (m.count12 === 0 && m.count14 === 0 && Date.now() - started < DENSITY_SAMPLE_WAIT) {
    await page.waitForTimeout(250);
    m = await page.evaluate(measureDensityInPage);
  }
  const waited = Date.now() - started;
  const waitNote = waited > 0 ? `，等样式落地 ${waited}ms 后重采` : '';
  const detail = `12px 节点 ${m.count12} 个 / 14px 节点 ${m.count14} 个，取样 ${m.sampled} 个文本节点（跳过 Monaco 子树 ${m.monacoSkipped} 个）${waitNote}，直方图 ${m.hist.join(' ')}`;
  const base = { expected, waited, ...m };
  if (m.count12 === 0 && m.count14 === 0) {
    return {
      ...base,
      status: 'no-sample',
      reason: `本格在 .monaco-editor 之外没有任何 12px/14px 的可见文本节点，密度未被断言（${detail}）`,
    };
  }
  const own = expected === 14 ? m.count14 : m.count12;
  const other = expected === 14 ? m.count12 : m.count14;
  if (own > other) {
    return { ...base, status: 'pass', reason: `密度 ${expected}px 主导（${detail}）` };
  }
  return {
    ...base,
    status: 'fail',
    reason:
      `密度断言不成立：本格期望 ${expected}px 主导（${cell.density === 'default' ? '设置页豁免档' : 'compact 档'}），` +
      `实测 ${m.count12 === m.count14 ? '两档计数相同、无法判定主导' : `由 ${expected === 14 ? 12 : 14}px 主导`}（${detail}）`,
  };
}

/** SplitPane 的两栏几何：窄视口应「同一列 + 各占满宽度」，宽视口应「同一行 + 左右分列」 */
function measurePanesInPage() {
  const side = document.querySelector('[data-testid="split-side-host"]');
  const main = document.querySelector('[data-testid="split-main-host"]');
  if (side === null || main === null || side.parentElement === null) return null;
  const s = side.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  const container = side.parentElement.getBoundingClientRect();
  // 注意：log 页侧栏在右（sidePosition="end"），故「并排」不能假设 side 在左，
  // 只判「同一行 + 两者水平不重叠」；堆叠同理只判「同一列 + 两者垂直不重叠」。
  return {
    side: { x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.width), h: Math.round(s.height) },
    main: { x: Math.round(m.x), y: Math.round(m.y), w: Math.round(m.width), h: Math.round(m.height) },
    containerWidth: Math.round(container.width),
    stacked: Math.abs(s.x - m.x) <= 1 && (s.y + s.height <= m.y + 1 || m.y + m.height <= s.y + 1),
    fullWidth: Math.abs(s.width - container.width) <= 1 && Math.abs(m.width - container.width) <= 1,
    sideBySide: Math.abs(s.y - m.y) <= 1 && (s.x + s.width <= m.x + 1 || m.x + m.width <= s.x + 1),
  };
}

/** 断言一页没有页面级横向溢出（themeProbe 为 waitForTheme 的实测结果，优先于重新取色） */
async function assertNoPageOverflow(page, theme, themeProbe = null) {
  const m = await page.evaluate(measureInPage);
  const overflow = m.scrollWidth > m.clientWidth + OVERFLOW_TOLERANCE;
  const isDark = themeProbe === null ? m.isDark : themeProbe.isDark;
  const themeOk = theme === 'dark' ? isDark === true : isDark === false;
  return {
    scrollWidth: m.scrollWidth,
    clientWidth: m.clientWidth,
    datasetTheme: themeProbe === null ? m.datasetTheme : themeProbe.dataset,
    isDark,
    status: overflow ? 'fail' : 'pass',
    reason: overflow
      ? `页面级横向溢出：scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth} + ${OVERFLOW_TOLERANCE}`
      : null,
    themeStatus: themeOk ? 'pass' : 'fail',
    themeReason: themeOk ? null : `主题未生效：期望 ${theme}，实测 data-theme=${m.datasetTheme} isDark=${isDark}`,
    offenders: overflow ? m.offenders : [],
  };
}

/**
 * 例外 1：两栏堆叠 / 并排（判据取自 split-pane.tsx 的 collapseBelow 默认值）。
 *
 * **为什么测量前要有界地等宿主出现（Fix round 3 实测到的竞态，不是预防性写法）**：
 * 日志页的提交详情栏在首帧会先挂上、随后**短暂整块消失**、再重新挂上。实测时间线（480px，`?select=`，
 * 60 次 / 50ms 采样压成段）：`commit-details` 与两个宿主在 ~25ms 同时出现 → ~540ms 起**三个一起消失**
 * ~500ms → ~800ms 重新挂上后稳定；8 轮探针里复现 1 轮，单独复跑该格 5 次里红 1 次。
 * 成因在容器侧：`selectedCommit = commits.find((c) => c.hash === selectedHash) ?? null`
 * （`apps/web-next/app/repos/[repoId]/page.tsx:179`）—— 提交列表在挂载后被重新装配的那一瞬间「找不到」，
 * `LogPage` 便走 `selectedCommit ? <SplitPane> : 主区独占` 的 else 分支，侧栏连同两个宿主一起卸载。
 *
 * 在那一刻采样会得到两种后果，**两种都是假的**：① 本断言报「未找到宿主」这种与布局无关的红；
 * ② 紧接着的页面级溢出断言量在一个「详情栏还没装回来」的页面上 —— 空页永不溢出，那是白通过。
 * 所以这里先有界地等宿主出现（10s，与 `assertHunkExpanded` 等 Monaco 懒加载同一口径），**等来之后
 * 再 settle 一次**，量的才是稳定态。宿主确实不出现（真的没有两栏）时照旧判红：判定没有被放宽，
 * 只是不再对「已知会自我修复的瞬时状态」下结论。等了多少毫秒写进通过原因，使这次竞态在产物里可见。
 */
const PANE_HOST_WAIT = 10000;

async function assertPanes(page, width, collapseBelow) {
  // 快路径与改动前**一字不差**：宿主都在 → 不等待、不额外 settle，直接量。
  let hostWait = 0;
  const present = await page.evaluate(
    () =>
      document.querySelector('[data-testid="split-side-host"]') !== null &&
      document.querySelector('[data-testid="split-main-host"]') !== null,
  );
  if (!present) {
    // 宿主在采样时缺席：这**正是**上面那段瞬时卸载（不是「没有两栏」的直接证据，故给有界等待）。
    const started = Date.now();
    try {
      await page.waitForSelector('[data-testid="split-side-host"]', { timeout: PANE_HOST_WAIT, state: 'attached' });
      await page.waitForSelector('[data-testid="split-main-host"]', { timeout: PANE_HOST_WAIT, state: 'attached' });
    } catch {
      return { status: 'fail', reason: `未找到 split-side-host / split-main-host 宿主（采样时缺席，再等 ${PANE_HOST_WAIT}ms 仍未出现）` };
    }
    hostWait = Date.now() - started;
    // 宿主是「等回来的」：它刚重新挂上，等布局静止再量，量的才是稳定态。
    await settle(page);
  }
  // 只有**真的等过**才写这句：否则每个两栏格都会带一句「等了 5ms」，把真信号（几百毫秒的瞬时卸载）淹掉。
  const waited = hostWait > 0 ? `（采样时宿主缺席，等 ${hostWait}ms 回来后重新静止才量）` : '';
  const panes = await page.evaluate(measurePanesInPage);
  if (panes === null) return { status: 'fail', reason: '未找到 split-side-host / split-main-host 宿主' };
  if (width < collapseBelow) {
    if (!panes.stacked || !panes.fullWidth) {
      return {
        status: 'fail',
        reason: `窄视口（${width} < collapseBelow ${collapseBelow}）两栏未纵向堆叠或未各占满宽度：side=${JSON.stringify(panes.side)} main=${JSON.stringify(panes.main)} container=${panes.containerWidth}`,
      };
    }
    return {
      status: 'pass',
      reason: `两栏纵向堆叠且各占满宽度（容器 ${panes.containerWidth}px）：side=${JSON.stringify(panes.side)} main=${JSON.stringify(panes.main)}${waited}`,
    };
  }
  if (!panes.sideBySide) {
    return {
      status: 'fail',
      reason: `宽视口（${width} >= collapseBelow ${collapseBelow}）两栏未左右并排：side=${JSON.stringify(panes.side)} main=${JSON.stringify(panes.main)}`,
    };
  }
  return { status: 'pass', reason: `两栏左右并排：side 宽 ${panes.side.w}px / main 宽 ${panes.main.w}px（容器 ${panes.containerWidth}px）${waited}` };
}

/**
 * 取「**被测量的那一个** Monaco 编辑器自己的横向滚动条滑块」的元素句柄。
 *
 * 为什么不用 `page.locator('.monaco-editor').nth(i).locator('.scrollbar.horizontal .slider')`：
 * 那个 CSS 在真实 DOM 上**不保证唯一** —— 控制器那一轮就在 dark/480 与 light/1024 两格上撞到
 * Playwright 的
 *   strict mode violation: locator('.monaco-editor').nth(2).locator('.scrollbar.horizontal .slider')
 *   resolved to 3 elements
 * 即同一个 `.monaco-editor` 子树里匹配到 3 个滑块。实测该页 `.monaco-editor` 集合里还含一个
 * `div.gutter monaco-editor`（diff 视图的分栏槽，clientWidth 0、无滚动条），而 diff 布局在窄档会
 * 切换 side-by-side / 内联，下标与子树都可能随落位变化：按 CSS 二次解析，等于把「拖哪一个」交给
 * 解析那一刻的 DOM，既会随宽度随机红，也可能拖到别人的滑块（那才是真正的假结论）。
 *
 * 改成在页面内**按元素引用**取，两个确定性来源：
 *   1) 编辑器由 `read()` 记录的 `info.index` 唯一指定（`all.indexOf(el)`，即完整 `.monaco-editor`
 *      NodeList 里的下标，与 `read()` 用的是同一份顺序）；
 *   2) 滑块只在该编辑器的子树里用 `el.querySelector('.scrollbar.horizontal .slider')` 找 ——
 *      取文档序第一个。编辑器自己的滚动条在 `.monaco-scrollable-element` 内、先于任何嵌套内容出现，
 *      所以这一个就是「它自己的」滑块；`candidates` 记录该子树里到底有几个候选，歧义写进结论而不再
 *      变成致命异常（若真出现多个，结论里会写明取了文档序第一个）。
 * ElementHandle 直接持有该节点，拖动前不再做任何 CSS 重解析，因此与 strict mode、与下标漂移都无关；
 * 而「拖不动就必须失败」这条判据一字未改（见下方 startX/endX 位移比较）。
 */
async function pickOwnHorizontalSlider(page, index) {
  const diag = await page.evaluate((i) => {
    const el = [...document.querySelectorAll('.monaco-editor')][i];
    if (el === undefined) return null;
    return {
      bars: el.querySelectorAll('.scrollbar.horizontal').length,
      candidates: el.querySelectorAll('.scrollbar.horizontal .slider').length,
      className: String(el.className).slice(0, 60),
    };
  }, index);
  const handle = await page.evaluateHandle((i) => {
    const el = [...document.querySelectorAll('.monaco-editor')][i];
    return el === undefined ? null : el.querySelector('.scrollbar.horizontal .slider');
  }, index);
  return { slider: handle.asElement(), diag };
}

/**
 * 例外 2：Monaco 内部横向滚动。
 * 先等 Monaco 完成首帧布局（`.view-lines` 出现时 style.width 可能还是视口宽，内容宽要晚一拍才落），
 * 再按两种真实情形断言：
 *   - 内容比编辑器宽 → 必须同时满足：编辑器宿主自身不溢出 + 它渲染了横向滚动条 + 拖动滑块内容真的位移；
 *   - 内容没超出（宽视口下长行放得下）→ 本档不需要内部横向滚动，只要求宿主不溢出。
 * 页面级断言由调用方另行判定：内部滚动 ≠ 页面溢出，两者必须同时成立。
 */
async function assertMonacoInternalScroll(page) {
  const read = () =>
    page.evaluate(() => {
      const all = [...document.querySelectorAll('.monaco-editor')];
      const editors = all.filter((el) => el.clientWidth > 0);
      if (editors.length === 0) return null;
      const measured = editors.map((el) => {
        const lines = el.querySelector('.view-lines');
        const scrollable = el.querySelector('.monaco-scrollable-element');
        const contentWidth = lines === null ? null : Math.round(lines.getBoundingClientRect().width);
        return {
          // 在完整 NodeList 里的下标：拖动滑块时必须定位到**同一个**编辑器
          // （此前用两套不同的排序分别「测量」与「取滑块」，实测选中了两个不同的栏 → 假红）
          index: all.indexOf(el),
          hostScrollWidth: el.scrollWidth,
          hostClientWidth: el.clientWidth,
          contentWidth,
          contentX: lines === null ? null : Math.round(lines.getBoundingClientRect().x),
          hasHorizontalScrollbar: el.querySelector('.scrollbar.horizontal') !== null,
          // Monaco 自己的滚动宿主（.monaco-scrollable-element 即类名里的 editor-scrollable）：
          // 它的 scrollWidth 是 Monaco 的「大滚动」哨兵（实测 16777216），**不是长行的度量**，
          // 故只用来断言「该容器确实持有可横向滚动的区间」；长行由 contentWidth 度量。
          scrollHostScrollWidth: scrollable === null ? null : scrollable.scrollWidth,
          scrollHostClientWidth: scrollable === null ? null : scrollable.clientWidth,
        };
      });
      // 选「最有代表性」的那个编辑器：优先内容真的溢出的，其次取可见宽度最大的那个
      // （并排模式下 360 档左栏会被压到 38px：它的溢出量最大但证据最不典型，故不用溢出量排序）
      measured.sort((a, b) => {
        const overA = (a.contentWidth ?? 0) > a.hostClientWidth ? 1 : 0;
        const overB = (b.contentWidth ?? 0) > b.hostClientWidth ? 1 : 0;
        if (overA !== overB) return overB - overA;
        return b.hostClientWidth - a.hostClientWidth;
      });
      return { editors: editors.length, best: measured[0] };
    });

  // 先等 Monaco 的几何稳定：DiffPage 的两栏编辑器是逐步落位的（clientWidth、内容宽、滚动条滑块宽度
  // 都各自晚一拍才定），过早测量会拿到没定型的几何 —— 实测 480 档曾因此选中一个滑块宽 20px 的中间态，
  // 拖动后内容位移为负（布局还在变）→ 假红。签名取「可见宽 + 内容宽 + 滑块宽/位」，连续两次一致才继续。
  // 注意：**必须等稳定之后再 read()**，否则读到的是稳定前的下标与基准 x（实测 koa 768 档因此假红）。
  let signature = '';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const next = await page.evaluate(() =>
      [...document.querySelectorAll('.monaco-editor')]
        .filter((el) => el.clientWidth > 0)
        .map((el) => {
          const lines = el.querySelector('.view-lines');
          const slider = el.querySelector('.scrollbar.horizontal .slider');
          return [
            el.clientWidth,
            lines === null ? 0 : Math.round(lines.getBoundingClientRect().width),
            slider === null ? 'n' : Math.round(slider.getBoundingClientRect().width),
            slider === null ? 'n' : slider.style.left,
          ].join(':');
        })
        .join(','),
    );
    if (next !== '' && next === signature) break;
    signature = next;
    await page.waitForTimeout(250);
  }
  let before = await read();
  if (before === null) return { status: 'fail', reason: '页面上没有可见的 .monaco-editor' };
  for (let attempt = 0; attempt < 20 && before.best.contentWidth !== null && before.best.contentWidth <= before.best.hostClientWidth; attempt += 1) {
    await page.waitForTimeout(300);
    before = await read();
  }
  const info = before.best;
  if (info.hostScrollWidth > info.hostClientWidth + OVERFLOW_TOLERANCE) {
    return { status: 'fail', reason: `Monaco 宿主自身溢出：${info.hostScrollWidth} > ${info.hostClientWidth}` };
  }
  if (info.contentWidth === null || info.contentWidth <= info.hostClientWidth) {
    return {
      status: 'pass',
      reason: `本档长行放得下（内容 ${info.contentWidth}px <= 编辑器 ${info.hostClientWidth}px），无需内部横向滚动；编辑器宿主自身 ${info.hostScrollWidth}px 不溢出`,
    };
  }
  if (!info.hasHorizontalScrollbar) {
    return { status: 'fail', reason: 'Monaco 未渲染横向滚动条元素（.scrollbar.horizontal）' };
  }
  // 编辑器**自己的**滚动宿主必须持有可横向滚动的区间（brief 的「Monaco host scrollWidth > clientWidth」）。
  // 口径说明：`.monaco-scrollable-element` 的 scrollWidth 是 Monaco 的大滚动哨兵（实测 16777216），
  // 这个不等式恒真、不能当作长行的证据；长行证据由上面的 contentWidth > hostClientWidth 承担。
  if (info.scrollHostScrollWidth === null || info.scrollHostScrollWidth <= info.scrollHostClientWidth + OVERFLOW_TOLERANCE) {
    return {
      status: 'fail',
      reason: `Monaco 滚动宿主无可横向滚动区间：scrollWidth ${info.scrollHostScrollWidth} <= clientWidth ${info.scrollHostClientWidth}`,
    };
  }
  // 拖动横向滚动条滑块：内容位移 > 0 即证明内部横向滚动可达（滚轮不产生 deltaX，不作为判据）。
  // 用 ElementHandle + scrollIntoViewIfNeeded：768/1024 档编辑器底部会落在视口之外，
  // 手算坐标的 mouse.move 落在视口外就拖不动（实测该两档因此失败）；
  // 而按 CSS 定位到「一个编辑器里的那一个滑块」会撞 strict mode（见 pickOwnHorizontalSlider 注释）。
  // 每轮重新取一次句柄：Monaco 在布局落位时可能重建滑块节点，旧句柄会 detached。
  // 位移基准在**按下前一刻**重测（内容 x 会随布局落位变化，用早先的读数当基准会算出负位移）；
  // 仍未位移则重试一次（Monaco 首次拖动的滑块可能尚未与模型同步）。
  let moved = 0;
  let startX = info.contentX;
  let endX = info.contentX;
  let sliderBox = null;
  let sliderDiag = null;
  let handleNote = '';
  for (let attempt = 0; attempt < 2 && moved <= 0; attempt += 1) {
    const picked = await pickOwnHorizontalSlider(page, info.index);
    sliderDiag = picked.diag;
    if (picked.slider === null) {
      return {
        status: 'fail',
        reason: `取不到第 ${info.index} 个 Monaco 编辑器自己的横向滑块（该编辑器 .scrollbar.horizontal=${sliderDiag?.bars ?? '—'} 个、滑块候选 ${sliderDiag?.candidates ?? '—'} 个，class=${sliderDiag?.className ?? '—'}）`,
      };
    }
    if (sliderDiag !== null && sliderDiag.candidates > 1) {
      handleNote = `（注意：该编辑器子树内 .scrollbar.horizontal .slider 有 ${sliderDiag.candidates} 个候选，按文档序取第一个 = 它自己的那一个）`;
    }
    await picked.slider.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    sliderBox = await picked.slider.boundingBox();
    if (sliderBox === null) return { status: 'fail', reason: '取不到 Monaco 横向滚动条滑块的几何' };
    startX = await page.evaluate(
      (index) => {
        const el = [...document.querySelectorAll('.monaco-editor')][index];
        const lines = el.querySelector('.view-lines');
        return lines === null ? null : Math.round(lines.getBoundingClientRect().x);
      },
      info.index,
    );
    await page.mouse.move(sliderBox.x + sliderBox.width / 2, sliderBox.y + sliderBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sliderBox.x + sliderBox.width / 2 + 120, sliderBox.y + sliderBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(450);
    endX = await page.evaluate(
      (index) => {
        const el = [...document.querySelectorAll('.monaco-editor')][index];
        const lines = el.querySelector('.view-lines');
        return lines === null ? null : Math.round(lines.getBoundingClientRect().x);
      },
      info.index,
    );
    moved = startX !== null && endX !== null ? startX - endX : 0;
  }
  if (moved <= 0) {
    return {
      status: 'fail',
      reason: `拖动 Monaco 横向滚动条后内容未位移：x ${startX} → ${endX}（滑块几何 ${JSON.stringify(sliderBox)}，取滑块方式：编辑器 #${info.index} 子树内文档序第一个 .slider，候选 ${sliderDiag?.candidates ?? '—'} 个）`,
    };
  }
  return {
    status: 'pass',
    reason: `内部横向滚动可用：内容 ${info.contentWidth}px > 编辑器 ${info.hostClientWidth}px（宿主自身 scrollWidth ${info.hostScrollWidth}px 不溢出；编辑器滚动宿主 scrollWidth ${info.scrollHostScrollWidth} > clientWidth ${info.scrollHostClientWidth}，具备横向滚动区间），拖动滑块后内容左移 ${moved}px${handleNote}`,
  };
}

// ---------------------------------------------------------------- 路由表

/**
 * **就绪预算的例外（只给实测慢的页面）**：本夹具下 `/api/repos/:id/submodules` 是全部接口里最慢的
 * 一个（本轮实测 10 次：3.6–5.8s，avg 4.4s；更早一轮记录到最慢 17.1s），该页的就绪门因此常在 5–8s
 * 才成立（本轮 768px 复跑 8/8 次都成立，最长 8.1s）。控制器那一轮唯一一次就绪超时正是这一格 ——
 * 25s 预算在「接口 17s + goto 3s + 机器争用」下没有余量。
 * 只给**同一个页面的两个格子**（`submodules` 与 `state:ellipsis-tooltip-submodule`）放宽到 60s，
 * 并保留「超时就判红」：不放宽全表、也不把没出现的门当作通过 —— 预算变大只是给慢接口留余量，
 * 门本身一条都不能少（就绪超时的原因里现在还会带上本格实测耗时与该格的 HTTP 异常，见 openCell）。
 */
const SLOW_GATE_TIMEOUT = 60000;

/**
 * 路由表 = web-next 全部 24 个页面（/ 首页 + /repos/:id 日志页 + 22 个子页），
 * 加两种「静态加载不产生」的日志页状态（?select= 选中提交、?compare= 分支对比）。
 *
 * 两段式就绪门（`ready` + `content`）：
 *   - `ready`   = 页面壳/工具行出现（证明路由挂上了）；
 *   - `content` = **数据级**选择器，必须真的命中条目。
 * 为什么必须两段：这些页面上不少 `ready` 点是「卡头工具行 / 状态卡」这类**静态**元素，
 * 数据还没到时它们照样渲染 —— 只等 `ready` 就会量到一个尚未装数据的页面，而**空页永远不会
 * 横向溢出**，该格于是成了白通过（不是失败，也不是跳过，是「什么都没证明的绿」）。
 * `content` 逐页核实过数据来源（组件源码里「数据到齐才渲染」的那一支），注释里给出依据；
 * 某页确实没有任何数据级内容时（对话-only 页 / 该夹具下必然为空），**在行内写明原因**而不是留白。
 *
 * **按路由的密度断言（本轮新增，见 assertDensity）**：每一格都带一个**期望基准字号** ——
 * 默认 **12px**（`PageShell` 不传 `density` ⇒ compact），设置页路由标 `density: 'default'` ⇒ **14px**
 * （antd 默认密度，用户显式要求的唯一豁免）。判据是该格文本的**主导**字号等于期望值，
 * 与页面级溢出断言同为**判定**（不是 note / 不是告警）：密度错档即判红，且**不参与重试**。
 * 为什么必须加它：本轮的 Critical 缺陷（`/merge` 整条路由没有密度归属、以 antd 默认 14px 渲染）
 * 在 576 格溢出矩阵里**全绿** —— 溢出为 0 与密度正确是两件事，只有这一条能看见后者。
 * `merge` 的背景文档为空（见 e2e 文档 §5.16④），但它渲染的对话框挂在 body 上，取样因此落在
 * 弹窗文本上 —— 这正是「同一弹窗从 /merge 进是 14px、从 /conflicts 进是 12px」那条链路的判据。
 *
 * `min`（内容级门的**命中数下限**）与 `gateTimeout`：
 *   `content` 命中 1 条就通过，仍可能是「一页只渲染出 22 个树节点里的 1 个」这类部分加载 ——
 *   故对**又大又与夹具无关**的列表给下限：browse 的树节点（实测 20）→ 10、console 的历史记录
 *   （实测 100）→ 10、settings 的 git 配置行（实测 9，键集由代码里的 `CONFIG_KEYS` 决定，不随夹具变）→ 4。
 *   实测命中数记在每格的 `readyItems` 里，跑完还会做一次跨档一致性检查（只告警不判红）。
 *   其余是**单行级 / 跟着夹具走**的小列表（stashes / tags / patches / shelves / worktrees /
 *   submodules / status 的变更行，各 2–7 行），下限一律 1：它们的行数会随夹具变化（drop 一个 stash、
 *   提交掉未跟踪文件都会减少行数），把当下的行数抄成下限，等于让「夹具被改过」直接变成一屏红；
 *   而 1 行已经足以否定「空页」这件事。夹具确实被清空时，命中 0 条仍然照判红（下限兜不住，也不该兜）。
 *
 * **夹具耦合（必须知道的一件事）**：下面这些内容级门要求**夹具里真的有那些内容**，而
 * `rebased-smoke` 里的 stash / 未跟踪文件 / tag / patch / shelf / worktree / submodule 都是
 * **可变状态**（用户随时可能 drop 一个 stash、提交掉未跟踪文件、删掉 tag）：
 *   browse 的树节点、settings 的 git 配置、status 的变更行、stashes、tags、patches、shelves、
 *   worktrees、submodules、console 的历史记录。
 * 夹具一旦被改动，这些格子会**如实判红**（提示「内容级就绪选择器未出现」），而不是静默跳过 ——
 * 这是有意的：那一格此时没有可量的数据，绿了才是错的。排查时先看夹具，不要先改门。
 */
function routeCells(ctx) {
  const q = encodeURIComponent;
  return [
    { name: 'dashboard', path: '/', ready: '[data-testid="repo-item"]' },
    { name: 'log', path: `/repos/${ctx.repo.id}`, ready: '[data-testid="commit-graph-row"]' },
    { name: 'log-select', path: `/repos/${ctx.repo.id}?select=${ctx.hash}`, ready: '[data-testid="commit-details"]' },
    { name: 'log-compare', path: `/repos/${ctx.repo.id}?compare=${ctx.branch}`, ready: '[data-testid="compare-title"]' },
    // browse：split-side-host 只在 entries 到齐且非空时渲染（browse-panel.tsx：!entries || length===0 → EmptyState），
    // 再要求文件树节点真的铺出来（nodes 由 entries 推导），把「树空了但宿主在」也挡住
    { name: 'browse', path: `/repos/${ctx.repo.id}/browse?rev=${ctx.hash}`, ready: '[data-testid="split-side-host"]', content: '[data-testid="split-side-host"] .ant-tree-treenode', min: 10 },
    { name: 'blame', path: `/repos/${ctx.repo.id}/blame?file=${q(ctx.file)}`, ready: '[data-testid="blame-file"]' },
    { name: 'branches', path: `/repos/${ctx.repo.id}/branches`, ready: '[data-testid^="row-local-"]' },
    { name: 'committed', path: `/repos/${ctx.repo.id}/committed`, ready: '[data-testid="committed-entry-0"]' },
    { name: 'history', path: `/repos/${ctx.repo.id}/history?file=${q(ctx.file)}`, ready: '[data-testid="history-entry-0"]' },
    { name: 'search', path: `/repos/${ctx.repo.id}/search`, ready: '[data-testid^="branch-quick-"]' },
    // merge：整页只有一个**常驻打开**的 Modal（背景文档为空），就绪点即弹窗内的分支选择器。
    // 这一格的**溢出**断言是弱的（背后文档为空 ⇒ 空页永不溢出，见 e2e 文档 §5.16④），
    // 但**密度**断言不空：取样覆盖 portal 里的弹窗文本，弹窗落在哪一档密度由它判定。
    { name: 'merge', path: `/repos/${ctx.repo.id}/merge`, ready: '[data-testid="merge-branch-select"]' },
    { name: 'remotes', path: `/repos/${ctx.repo.id}/remotes`, ready: '[data-testid^="row-remote-"]' },
    // conflicts：就绪点是页脚那个「继续」按钮的 span（`ConflictRow` 一条都不渲染时它也在），
    // 故内容级门改成**计数标题**「冲突文件（N）」—— 它的 N 来自 `conflictList`，且容器在
    // `if (!conflictList) return null` 之前不渲染任何东西，标题出现即等价于冲突列表已到达。
    // 该夹具（rebased-smoke）`GET /conflicts` 返回 `{"conflicts":[]}`，所以**没有** `conflict-row-*`
    // 可等：这一格证明的是「数据到达后的空态页不溢出」，冲突行态的几何仍是未覆盖项（见 e2e 文档 §5.16④）。
    { name: 'conflicts', path: `/repos/${ctx.repo.id}/conflicts`, ready: '[data-testid="continue-merge-wrap"]', content: 'text=冲突文件（', min: 1 },
    {
      name: 'diff',
      path: `/repos/${ctx.repo.id}/diff?file=${q(ctx.file)}&from=${ctx.prevHash}&to=${ctx.hash}`,
      ready: '.monaco-editor .view-lines',
      after: assertMonacoInternalScroll,
    },
    // settings：git-executable-card 是**静态** Card（SettingsPage 无条件渲染全部卡片，容器也没有提前 return），
    // 数据没到时它照样在 —— 这正是「量到未装数据的页面」的典型；改成等 git 配置行（9 个 CONFIG_KEYS 的
    // 输入行，`config-view` 的响应到达才渲染）真的出现。
    // density: 'default' = 本路由是**密度豁免页**（用户显式要求设置页保持 antd 默认密度），
    // 故密度断言期望 14px；其余所有格子省略该字段 = 期望 compact 12px。改这一档必须同时改这里，
    // 否则「设置页被别的路由的紧凑主题罩住」这类回归不会被发现。
    { name: 'settings', path: `/repos/${ctx.repo.id}/settings`, ready: '[data-testid="git-executable-card"]', content: '[data-testid^="config-input-"]', min: 4, density: 'default' },
    { name: 'stashes', path: `/repos/${ctx.repo.id}/stashes`, ready: '[data-testid="stash-save-button"]', content: '[data-testid^="row-stash-"]', min: 1 },
    // status：manage-changelists 是工具行按钮；内容级门等变更行（staged/unstaged/untracked 三组任一）
    { name: 'status', path: `/repos/${ctx.repo.id}/status`, ready: '[data-testid="manage-changelists"]', content: '[data-testid^="row-staged-"], [data-testid^="row-unstaged-"], [data-testid^="row-untracked-"]', min: 1 },
    { name: 'tags', path: `/repos/${ctx.repo.id}/tags`, ready: '[data-testid="tag-create-button"]', content: '[data-testid^="tag-row-"]', min: 1 },
    { name: 'patches', path: `/repos/${ctx.repo.id}/patches`, ready: '[data-testid="patch-create-button"]', content: '[data-testid^="row-patch-"]', min: 1 },
    { name: 'shelves', path: `/repos/${ctx.repo.id}/shelves`, ready: '[data-testid="shelf-save-button"]', content: '[data-testid^="row-shelf-"]', min: 1 },
    // console：这一页**没有**提前 return（ConsolePanel 无条件渲染，entries 未到时只是空列表），
    // 故 console-refresh 是纯静态元素 —— 必须等内容行 `console-row-<id>`（服务端 exec 缓冲的记录）
    { name: 'console', path: `/repos/${ctx.repo.id}/console`, ready: '[data-testid="console-refresh"]', content: '[data-testid^="console-row-"]', min: 10 },
    // ignore：**对话-only 页**——页面主体只有「返回日志」+「编辑忽略规则」两个按钮，忽略规则正文只在 Modal 里，
    // 页面上不存在任何数据级内容可等。容器 `if (!contents) return null`（useIgnore 未返回前整页不渲染），
    // 故 `edit-ignore-button` 出现本身已蕴含 contents 到达；其后页面再无别的数据会晚到，不存在「量到空页」的窗口。
    // （Modal 内的规则正文属弹窗内部滚动，不在页面级口径内，见 e2e 文档 §5.16④。）
    { name: 'ignore', path: `/repos/${ctx.repo.id}/ignore`, ready: '[data-testid="edit-ignore-button"]' },
    // github / gitlab：容器 `if (status === undefined) return null`，状态到达前整页不渲染；
    // 该夹具 status.detected=false（无远程/无令牌），面板就只有「未检测到远程/未配置令牌」提示卡这一种内容，
    // PR/MR 列表根本不渲染 —— 页面上不存在别的数据级内容可等。
    // 装好数据后的列表形态由 `state:github-expanded-diff` / `state:gitlab-expanded-diff` 两格覆盖（打桩宿主 API）。
    { name: 'github', path: `/repos/${ctx.repo.id}/github`, ready: '[data-testid="github-status-card"]' },
    { name: 'gitlab', path: `/repos/${ctx.repo.id}/gitlab`, ready: '[data-testid="gitlab-status-card"]' },
    { name: 'worktrees', path: `/repos/${ctx.repo.id}/worktrees`, ready: '[data-testid="worktree-refresh"]', content: '[data-testid^="worktree-row-"]', min: 1 },
    { name: 'submodules', path: `/repos/${ctx.repo.id}/submodules`, ready: '[data-testid="submodule-refresh"]', content: '[data-testid^="submodule-row-"]', min: 1, gateTimeout: SLOW_GATE_TIMEOUT },
  ];
}

// ---------------------------------------------------------------- 状态格（静态加载不产生）

/** 打桩用的补丁：含一条超长行，用于把「展开的 hunk 视图里嵌 Monaco」这一最易溢出的形态顶出来 */
const STUB_PATCH = [
  '@@ -1,6 +1,8 @@',
  " import { bootstrap } from './src/app';",
  '-export const APP_VERSION = "1.0.0";',
  '+export const APP_VERSION = "1.0.1";',
  '+// 这一行刻意很长：验证展开的 hunk 视图在窄视口下不会把页面顶宽 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ' export function main(): void {',
  '   bootstrap();',
  ' }',
].join('\n');

const STUB_FILE = {
  path: 'src/very/long/path/that/should/be/truncated/app-with-a-long-name.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
};

const GITHUB_PR = {
  number: 7,
  title: 'fix: 一个相当长的拉取请求标题，用于验证窄视口下的截断与横向溢出',
  author: 'octocat',
  state: 'open',
  merged: false,
  baseRef: 'main',
  headRef: 'feature/a-very-long-branch-name-for-overflow-checking',
  createdAtIso: '2026-09-01T00:00:00Z',
  updatedAtIso: '2026-09-02T00:00:00Z',
};

const GITLAB_MR = {
  iid: 9,
  title: 'fix: 一个相当长的合并请求标题，用于验证窄视口下的截断与横向溢出',
  author: 'tanuki',
  state: 'opened',
  sourceBranch: 'feature/a-very-long-branch-name-for-overflow-checking',
  targetBranch: 'main',
  createdAtIso: '2026-09-01T00:00:00Z',
  updatedAtIso: '2026-09-02T00:00:00Z',
};

/** 注册一组 API 打桩；payload 带 __status 时按该状态码返回（认证弹窗用例要 401） */
async function stubJson(page, entries) {
  for (const [pattern, payload] of entries) {
    await page.route(pattern, (route) => {
      const status = payload.__status ?? 200;
      const body = payload.__status === undefined ? payload : payload.body;
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
  }
}

/**
 * 展开差异格的自有断言：hunk-diff-view 真的渲染出来了（而不是只开了个空壳）。
 * **两个**条件都是断言，缺一即失败：① `hunk-diff-block-0` 存在；② 展开区内至少有一个**可见的**
 * `.monaco-editor`。此前②只写进 reason 文本、不参与判定，于是「展开的 diff 内含 Monaco」只是注释——
 * 一旦 hunk-diff-view 退化成纯文本渲染，该格仍会绿。Monaco 是懒加载的（`monaco-lazy`），
 * 故给它一段有界的等待（10s）再判失败，避免把「还没加载完」误判成退化。
 */
async function assertHunkExpanded(page) {
  if ((await page.locator('[data-testid="hunk-diff-block-0"]').count()) === 0) {
    return { status: 'fail', reason: 'hunk-diff-view 未渲染（hunk-diff-block-0 缺失）' };
  }
  let monaco = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    monaco = await page.evaluate(() => [...document.querySelectorAll('.monaco-editor')].filter((el) => el.clientWidth > 0).length);
    if (monaco > 0) break;
    await page.waitForTimeout(500);
  }
  if (monaco < 1) {
    return { status: 'fail', reason: 'hunk-diff-view 已展开但展开区内没有可见的 .monaco-editor（期望 ≥1）：展开的 diff 必须内含 Monaco' };
  }
  return { status: 'pass', reason: `hunk-diff-view 已展开，内含 ${monaco} 个可见 Monaco 编辑器` };
}

/**
 * EllipsisText 的 tooltip 断言（jsdom 测不出来的那条）。
 * 目标 = 重置弹窗里 EllipsisText(mono) 渲染的 `${短哈希} ${提交信息}`（长 ref 值）。
 * 判据用 antd 自己的两个信号，不猜样式：
 *   - 宿主元素被加上 `ant-tooltip-open`（antd 在浮层打开时挂的类）；
 *   - 浮层 `.ant-tooltip` 的内容文本等于完整值（antd v6 的内容节点是 `.ant-tooltip-container`，
 *     没有 `.ant-tooltip-inner`，按 v5 的类名取会取到空串）。
 * 溢出与否都要断言：溢出必须弹、且内容=完整值；未溢出必须不弹（同一个夹具/宽度组合下二者互斥）。
 */
async function assertEllipsisTooltip(page) {
  // 选目标：只考虑「可见且真的有宽度」的 EllipsisText（隐藏/零宽的元素悬停不到，也无从谈溢出），
  // 取其中溢出量最大的一个 —— 结果与 DOM 顺序无关。
  const pick = await page.evaluate(() => {
    const all = [...document.querySelectorAll('span[class*="ant-typography-ellipsis"]')];
    const visible = all.filter((el) => el.clientWidth > 0 && el.getBoundingClientRect().width > 0);
    if (visible.length === 0) return { index: -1, total: all.length, visible: 0 };
    const ranked = [...visible].sort((a, b) => b.scrollWidth - b.clientWidth - (a.scrollWidth - a.clientWidth));
    const target = ranked[0];
    return {
      index: all.indexOf(target),
      total: all.length,
      visible: visible.length,
      text: (target.textContent ?? '').trim(),
      scrollWidth: target.scrollWidth,
      clientWidth: target.clientWidth,
      overflows: target.scrollWidth > target.clientWidth,
    };
  });
  if (pick.index < 0) {
    return { status: 'fail', reason: `页面上没有可见的 EllipsisText（共 ${pick.total} 个，可见 0 个）` };
  }
  // 用 locator.hover()：它自带 scrollIntoViewIfNeeded + 真实鼠标移动，比手算坐标稳
  // （手算在元素被容器滚动到视口外时会 hover 到别处，实测在 480 档即因此失败）
  const target = page.locator('span[class*="ant-typography-ellipsis"]').nth(pick.index);
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await page.waitForTimeout(800);
  const probe = await page.evaluate(() => {
    const opened = document.querySelector('.ant-tooltip-open') !== null;
    const tips = [...document.querySelectorAll('.ant-tooltip')]
      .filter((el) => !el.classList.contains('ant-tooltip-hidden') && getComputedStyle(el).display !== 'none')
      .map((el) => (el.querySelector('.ant-tooltip-container') ?? el).textContent?.trim() ?? '')
      .filter((text) => text !== '');
    return { opened, tips };
  });
  const wantTooltip = pick.overflows;
  if (wantTooltip) {
    if (!probe.opened) {
      return { status: 'fail', reason: `EllipsisText 溢出（${pick.scrollWidth} > ${pick.clientWidth}）但悬停未打开 tooltip（无 ant-tooltip-open）` };
    }
    if (!probe.tips.includes(pick.text)) {
      return { status: 'fail', reason: `tooltip 内容与完整值不符：${JSON.stringify(probe.tips)} vs ${JSON.stringify(pick.text)}` };
    }
    return {
      status: 'pass',
      reason: `溢出 ${pick.scrollWidth} > ${pick.clientWidth}，悬停弹出 tooltip 且内容=完整值：${JSON.stringify(probe.tips[0])}`,
    };
  }
  if (probe.opened || probe.tips.length !== 0) {
    return { status: 'fail', reason: `未溢出（${pick.scrollWidth} <= ${pick.clientWidth}）却弹出了 tooltip：${JSON.stringify(probe)}` };
  }
  return {
    status: 'pass',
    reason: `未溢出（${pick.scrollWidth} <= ${pick.clientWidth}），悬停如约不弹 tooltip（antd 以真实溢出为准）`,
  };
}

/**
 * 状态格：每个都给出「打桩 + 操作序列 + 状态自有断言」。
 * ready 是**操作前**的就绪选择器；展开/弹窗后的就绪在 interact 里各自等待。
 * 为什么要打桩：GitHub/GitLab 面板要真实令牌（本检出没有），认证弹窗要一次失败的远程操作。
 * 打的是宿主 API 数据，断言落到的仍是真实组件与真实 DOM。
 */
function stateCells(ctx) {
  // 必须锚定结尾：page.route 的正则做的是「搜索」而非全匹配，
  // 不锚定时 `/github/prs/7` 会把 `/github/prs/7/timeline` 也吃掉（后注册的优先），
  // 于是 timeline 拿到 detail 的 JSON、`timeline.entries` 为 undefined 直接崩掉面板。
  const api = (suffix) => new RegExp(`/api/repos/[^/]+/${suffix}$`);
  return [
    {
      name: 'state:github-expanded-diff',
      path: `/repos/${ctx.repo.id}/github`,
      ready: '[data-testid="github-pr-row-7"]',
      kind: 'state',
      setup: (page) =>
        stubJson(page, [
          [api('github/status'), { detected: true, repo: { owner: 'acme', name: 'demo', remoteUrl: 'git@github.com:acme/demo.git' }, account: 'octocat' }],
          [api('github/prs\\?[^/]*'), { prs: [GITHUB_PR] }],
          [api('github/prs/7/timeline'), { entries: [] }],
          [api('github/prs/7/review-comments'), { comments: [] }],
          [api('github/prs/7/files'), { files: [{ ...STUB_FILE, patch: STUB_PATCH }] }],
          [api('github/prs/7'), { ...GITHUB_PR, body: '描述', mergeable: true, reviewDecision: 'NONE', commentsCount: 0, additions: 2, deletions: 1 }],
        ]),
      interact: async (page) => {
        await page.locator('[data-testid="github-pr-row-7"]').click();
        await page.waitForSelector('[data-testid="github-detail-title"]', { timeout: 15000 });
        await page.getByRole('tab', { name: '文件' }).click();
        await page.waitForSelector('[data-testid="github-file-0"]', { timeout: 15000 });
        await page.locator('[data-testid="github-diff-toggle-0"]').click();
        await page.waitForSelector('[data-testid="hunk-diff-block-0"]', { timeout: 20000 });
        await page.waitForSelector('.monaco-editor .view-lines', { timeout: 20000 }).catch(() => undefined);
        await page.waitForTimeout(800);
      },
      verify: assertHunkExpanded,
    },
    {
      name: 'state:gitlab-expanded-diff',
      path: `/repos/${ctx.repo.id}/gitlab`,
      ready: '[data-testid="gitlab-mr-row-9"]',
      kind: 'state',
      setup: (page) =>
        stubJson(page, [
          [api('gitlab/status'), { detected: true, repo: { owner: 'acme', name: 'demo', remoteUrl: 'git@gitlab.com:acme/demo.git' }, account: 'tanuki' }],
          [api('gitlab/mrs\\?[^/]*'), { mrs: [GITLAB_MR] }],
          [api('gitlab/mrs/9/timeline'), { entries: [] }],
          [api('gitlab/mrs/9/discussions'), { notes: [] }],
          [api('gitlab/mrs/9/files'), { files: [{ ...STUB_FILE, diff: STUB_PATCH }] }],
          [api('gitlab/mrs/9'), { ...GITLAB_MR, body: '描述', mergeable: true, reviewState: 'NONE', commentsCount: 0, additions: 2, deletions: 1 }],
        ]),
      interact: async (page) => {
        await page.locator('[data-testid="gitlab-mr-row-9"]').click();
        await page.waitForSelector('[data-testid="gitlab-detail-title"]', { timeout: 15000 });
        await page.getByRole('tab', { name: '文件' }).click();
        await page.waitForSelector('[data-testid="gitlab-file-0"]', { timeout: 15000 });
        await page.locator('[data-testid="gitlab-diff-toggle-0"]').click();
        await page.waitForSelector('[data-testid="hunk-diff-block-0"]', { timeout: 20000 });
        await page.waitForSelector('.monaco-editor .view-lines', { timeout: 20000 }).catch(() => undefined);
        await page.waitForTimeout(800);
      },
      verify: assertHunkExpanded,
    },
    {
      name: 'state:auth-dialog',
      path: `/repos/${ctx.repo.id}`,
      ready: '[data-testid="commit-graph-row"]',
      kind: 'state',
      // 推送请求打桩成 401 AUTH_FAILED：容器据此打开 AuthDialog（不会真的 push，夹具仓库不被改动）
      setup: (page) =>
        stubJson(page, [
          [api('push'), { __status: 401, body: { error: { code: 'AUTH_FAILED', message: '需要凭据', context: { host: 'github.com' } } } }],
        ]),
      interact: async (page) => {
        await page.getByRole('button', { name: /更多/ }).first().click();
        await page.waitForTimeout(300);
        await page.getByText('推送', { exact: true }).last().click();
        await page.waitForSelector('.ant-modal-title', { timeout: 10000 });
        await page.getByRole('button', { name: /确\s*定/ }).last().click();
        await page.waitForSelector('[data-testid="auth-host"]', { timeout: 10000 });
      },
      verify: async (page) => {
        const host = (await page.locator('[data-testid="auth-host"]').textContent()) ?? '';
        const titles = await page.locator('.ant-modal-title').allTextContents();
        if (!titles.includes('需要认证')) return { status: 'fail', reason: `认证弹窗标题异常：${JSON.stringify(titles)}` };
        if (host.trim() === '') return { status: 'fail', reason: '认证弹窗未渲染 host' };
        return { status: 'pass', reason: `认证弹窗已打开，host=${host.trim()}` };
      },
    },
    {
      name: 'state:reset-dialog',
      path: `/repos/${ctx.repo.id}?select=${ctx.longest.hash}`,
      ready: '[data-testid="reset-here"]',
      kind: 'state',
      interact: async (page) => {
        await page.locator('[data-testid="reset-here"]').first().click();
        await page.waitForSelector('.ant-modal-title', { timeout: 10000 });
        await page.waitForTimeout(400);
      },
      verify: async (page) => {
        const titles = await page.locator('.ant-modal-title').allTextContents();
        if (!titles.includes('重置到')) return { status: 'fail', reason: `重置弹窗标题异常：${JSON.stringify(titles)}` };
        return { status: 'pass', reason: '重置弹窗已打开（EllipsisText 渲染 ref + 提交信息）' };
      },
    },
    {
      name: 'state:ellipsis-tooltip',
      path: `/repos/${ctx.repo.id}?select=${ctx.longest.hash}`,
      ready: '[data-testid="reset-here"]',
      kind: 'state',
      interact: async (page) => {
        await page.locator('[data-testid="reset-here"]').first().click();
        await page.waitForSelector('.ant-modal-title', { timeout: 10000 });
        await page.waitForTimeout(400);
      },
      verify: assertEllipsisTooltip,
    },
    {
      // 第二个站点：submodules 页的远端 URL（EllipsisText maxWidth=220）。同一夹具的两个 EllipsisText
      // 站点在不同宽度上分别落于「溢出」与「不溢出」两侧，正反两半都被实测到。
      //
      // 就绪门（Fix round 2）：控制器那一轮这一格报过「就绪选择器未出现：[data-testid="submodule-refresh"]」。
      // 实测结论是**预算不够**，不是选择器不可靠、也不是这一格的内容级门缺失：
      //   - `submodule-refresh` 是**数据级**信号：容器 `if (!submodules) return null`（submodules/page.tsx:29），
      //     卡头工具行与数据同一次 render 挂上；本页没有「壳在、数据没到」的窗口。
      //   - 本轮 768px 复跑 8/8 次门都出现（最长 8.1s，见文件头 SLOW_GATE_TIMEOUT 的依据），
      //     该页接口 `/api/repos/:id/submodules` 是本夹具最慢的一个（实测 avg 4.4s、更早一轮 17.1s）。
      // 故：保留这一条 ready 门，另加**同一页 route 格用的那条数据级内容门**（远端 URL 就在这些行里，
      // 悬停断言要量的是行内的 EllipsisText），并按实测给 60s 预算；门一条没放宽。
      name: 'state:ellipsis-tooltip-submodule',
      path: `/repos/${ctx.repo.id}/submodules`,
      ready: '[data-testid="submodule-refresh"]',
      content: '[data-testid^="submodule-row-"]',
      min: 1,
      gateTimeout: SLOW_GATE_TIMEOUT,
      kind: 'state',
      verify: (page) => assertEllipsisTooltip(page),
    },
  ];
}

// ---------------------------------------------------------------- 运行

/** 等页面静止：滚动量/高度/节点数连续两次采样一致，避免把异步数据到达前的中间态当成结论 */
async function settle(page, { tries = 15, gap = 200 } = {}) {
  let prev = null;
  for (let i = 0; i < tries; i += 1) {
    const now = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      nodes: document.querySelectorAll('body *').length,
      theme: document.documentElement.dataset.theme ?? null,
      background: getComputedStyle(document.body).backgroundColor,
    }));
    if (
      prev !== null &&
      now.sw === prev.sw &&
      now.sh === prev.sh &&
      now.nodes === prev.nodes &&
      now.theme === prev.theme &&
      now.background === prev.background
    ) {
      return;
    }
    prev = now;
    await page.waitForTimeout(gap);
  }
}

/**
 * 主题探针是否落在期望档（waitForTheme 的返回值 → 布尔）。
 */
function themeApplied(probe, theme) {
  return theme === 'dark' ? probe.isDark === true : probe.isDark === false;
}

/** 读一次主题探针（底色明度 + data-theme）；waitForTheme 与「重载后再判一次」都用它 */
async function readThemeProbe(page) {
  return page.evaluate(() => {
    const background = getComputedStyle(document.body).backgroundColor;
    const rgb = /(\d+),\s*(\d+),\s*(\d+)/.exec(background);
    const luma = rgb === null ? null : (Number(rgb[1]) * 299 + Number(rgb[2]) * 587 + Number(rgb[3]) * 114) / 1000;
    return { isDark: luma === null ? null : luma < 128, dataset: document.documentElement.dataset.theme ?? null, background };
  });
}

/**
 * 等主题真的落到文档上。
 * 为什么需要：主题来自 GET /api/settings，首帧按暗色兜底、设置到达后才写 data-theme/底色；
 * 切换主题后的第一次加载可能量到兜底色（实测 light 档第一格读出 data-theme=dark），属测量竞态。
 * 判定用底色的明度，两个 app 都适用（web-koa 不写 data-theme，但它恒为暗色）。
 *
 * 返回值改成 `{ probe, reloaded }`：**是否发生过整页重载必须向上传递**（Fix round 2）——
 * 重载会把页面打回「数据还没到」的状态，调用方必须据此重跑该格的就绪门，否则会量到一个空页并判绿。
 */
async function waitForTheme(page, theme, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let reloaded = false;
  for (;;) {
    const probe = await readThemeProbe(page);
    if (themeApplied(probe, theme)) return { probe, reloaded };
    if (Date.now() > deadline) {
      if (reloaded) return { probe, reloaded };
      // 兜底：整页重载一次再等（设置接口在 dev 首访可能还没就绪）
      reloaded = true;
      await page.reload({ waitUntil: 'domcontentloaded' });
    } else {
      await page.waitForTimeout(200);
    }
  }
}

/**
 * 导航 → 两段式就绪门 → 等静止。
 * 就绪选择器缺失或**内容级断言不成立**（cell.content 存在但一条都没命中）→ 返回失败原因：
 * 空页上的溢出断言没有意义，宁可把这一格判红，也不能让它以「没有内容可溢出」的方式绿掉。
 * 返回 `{ error, count }`：count 为内容级选择器的命中数（记进明细，作为「这一格确实量的是有数据的页面」的证据）。
 *
 * 预算：默认用 --timeout（25s）；`cell.gateTimeout` 只给**实测慢**的页面放宽（见 SLOW_GATE_TIMEOUT），
 * 且失败原因里带上本格实测耗时 —— 「门到底等了多久」是区分「预算不够」与「页面真的没出来」的关键信息。
 */
async function openCell(page, url, cell, timeout) {
  const budget = cell.gateTimeout ?? timeout;
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: budget });
  try {
    await page.waitForSelector(cell.ready, { timeout: budget, state: 'attached' });
  } catch {
    return { error: `就绪选择器未出现：${cell.ready}（本格已等 ${Date.now() - started}ms，预算 ${budget}ms）`, count: null };
  }
  let count = null;
  if (cell.content !== undefined) {
    const min = cell.min ?? 1;
    let contentAt = Date.now();
    try {
      await page.waitForSelector(cell.content, { timeout: budget, state: 'attached' });
    } catch {
      return {
        error: `内容级就绪选择器未出现：${cell.content}（只等 ${cell.ready} 会量到尚未装数据的页面，空页永不溢出 → 该格是白通过；本格已等 ${Date.now() - started}ms，预算 ${budget}ms）`,
        count: 0,
      };
    }
    contentAt = Date.now() - contentAt;
    count = await page.locator(cell.content).count();
    // 命中数下限：content 命中 1 条仍可能是「一页只渲染出 22 个树节点里的 1 个」这类部分加载，
    // 故对列表给 min（大列表给实测量级之下的阈值，小列表给 1，理由见 routeCells 顶部注释）。
    if (count < min) {
      return { error: `内容级就绪断言不成立：${cell.content} 命中 ${count} 条 < 下限 ${min}（部分加载的页面不该算通过；内容门耗时 ${contentAt}ms）`, count };
    }
  }
  await settle(page);
  return { error: null, count };
}

/**
 * 就绪门与主题门的**结构性**串联（Fix round 2 的回归修复）。
 *
 * 流程：`openCell`（导航 + 两段式就绪门 + settle）→ 主题门；**只要这一轮里发生过整页重载，
 * 就把整格从 openCell 起重跑一次**（最多 MAX_THEME_RELOAD_ROUNDS 轮）。
 *
 * 为什么必须结构性做、而不在每个调用点补一句：`waitForTheme` 在主题迟迟不落时会
 * `page.reload()`（见上），重载后页面回到「数据还没到」的状态，而原来的代码紧接着就
 * `assertNoPageOverflow` 并直接测量 —— 于是**刚重载、内容未到的页面**（scrollWidth == clientWidth
 * 的空页）会被判绿。那正是本脚本存在的意义（堵「空页永不溢出」的假绿）被自己打开的一道后门：
 * 在评审担心的「主题未生效连片失败」场景里，一次主题重载就足以把本该红的格子洗成绿的。
 * 所以这里不按调用点打补丁，而是让所有格子都只经过 prepareCell 这一个入口：
 * 「重载 ⇒ 重跑就绪门」是流程本身的性质，不是某一处的记忆。
 */
const MAX_THEME_RELOAD_ROUNDS = 3;

async function prepareCell(page, url, cell, theme, timeout, base) {
  for (let round = 0; round < MAX_THEME_RELOAD_ROUNDS; round += 1) {
    const opened = await openCell(page, url, cell, timeout);
    if (opened.error !== null) return { error: opened.error, count: opened.count, themeProbe: null };
    // 主题是**服务端共享的可变设置**，不是本进程私有的：本机同时开着别的会话时（如有人在浏览器里
    // 点设置页「保存」），那个会话会把 theme 一起写回去，脚本这一轮的主题就没了 —— 实测发生过
    // （light 块跑到第 21 格起连片失败，全是「主题未生效」）。这里**只把测量前提重新立起来**：
    // 发现不匹配就重发一次 PUT /api/settings 再等一次；最终仍以实测探针为准（判定没有被放宽），
    // 确实不生效时该格照旧判红。
    let attempt = await waitForTheme(page, theme);
    if (!themeApplied(attempt.probe, theme)) {
      await putJson(`${base}/api/settings`, { theme });
      const retry = await waitForTheme(page, theme);
      attempt = { probe: retry.probe, reloaded: attempt.reloaded || retry.reloaded };
    }
    // 没重载：这一格的就绪门与主题探针取自同一个页面状态，可以交给调用方测量。
    if (!attempt.reloaded) return { error: null, count: opened.count, themeProbe: attempt.probe };
    // 重载过：就绪门必须在**重载之后**的页面上重新成立，故整轮重来（下一轮从 openCell 起）。
  }
  // 连续 MAX 轮都在重载（主题始终落不下）：仍要在重载之后的页面上把门跑一次，
  // 再按**这一刻**实测到的主题判定 —— 绝不允许用「重载前」的探针给重载后的页面发通行证。
  const last = await openCell(page, url, cell, timeout);
  if (last.error !== null) return { error: last.error, count: last.count, themeProbe: null };
  return { error: null, count: last.count, themeProbe: await readThemeProbe(page) };
}

/**
 * 这一格的失败是「环境中断」还是「结论」？
 *
 * 只有下面这些情形算**环境中断**（允许整格重来一次）：页面在预算内根本没渲染出来、导航/选择器超时、
 * 执行上下文被导航打断、主题还没落到文档上。它们全都不涉及任何断言判据。
 *
 * **永远不算中断**（不重试，直接判红）：
 *   - 页面级横向溢出 —— 这是本脚本要给的结论本身（**已测量并溢出 = 结论**，绝不重试）；
 *   - 例外断言失败（两栏堆叠 / Monaco 拖动没位移 / tooltip 该弹没弹或不该弹却弹了）——同样是结论；
 *   - **密度断言失败**（`密度断言:` —— 该格文本的主导字号不是期望档）——同样是结论：密度档位不会
 *     因为再导航一次而改变，重试只会把一次明确的错误洗成运气；
 *   - 内容级命中数低于下限（`命中 N 条 < 下限 M`，N > 0）—— 说明量到的是「部分加载」的页面，也是结论。
 *
 * 注意一处**文案容易读错的地方**：内容级门**一条都没命中**时（`内容级就绪选择器未出现…`，命中数 0）
 * 与就绪门**共用**「就绪选择器未出现」这个说法，故它落在下面的中断正则里、**会被重试一次**。这是有意的：
 * 0 命中与「页面整页没渲染」在本环境里往往是同一件事（dev 按需编译、别的会话重启服务），而重试**同样**要
 * 过完整的两段式就绪门，**不可能凭重试拿到一个空洞的绿**（第二次照样 0 命中就照样判红）。实测见过：
 * `dark/1920 console` 首轮 `内容级就绪选择器未出现…ready=0` → 重跑后通过。
 * 真正被排除在重试之外的，是上面那条「命中了但低于下限」的结论。
 *
 * 为什么这条不是「把超时调大」：**每次尝试的预算一字未改**（25s / 例外②的 60s），两次都没过**照样判红**；
 * 而且尝试次数与**首轮**失败原因都写进明细 JSON（`attempts` / `firstAttemptReason`）并在汇总里逐格列出，
 * 所以「哪些格子是重试之后才绿的」在产物里一眼可见，不会被当成一次通过。
 * 它解决的是本环境的真实噪声：dev 服务按需编译 + 同一工作区别的会话改代码/切夹具分支时，
 * 页码窗口里整页不渲染，那种红与本任务要断言的布局毫无关系。
 */
function isStall(record) {
  if (record.status !== 'fail') return false;
  const reason = record.reason ?? '';
  const measured = record.scrollWidth !== null && record.clientWidth !== null;
  if (measured && record.scrollWidth > record.clientWidth + OVERFLOW_TOLERANCE) return false;
  if (/例外断言:/.test(reason)) return false;
  if (/密度断言:/.test(reason)) return false;
  if (/命中 \d+ 条 < 下限/.test(reason)) return false;
  return /就绪选择器未出现|page\.goto: Timeout|page\.waitForSelector: Timeout|Execution context was destroyed|主题未生效/.test(reason);
}

/** 最多尝试几次（1 次重试）。常量写在这里是为了让上面的判据有据可依、也便于将来收紧。 */
const MAX_CELL_ATTEMPTS = 2;

async function run(opts, pw, exe) {
  const collapseBelow = readCollapseBelow();
  const ctx = await loadFixture(opts.base, opts.repo);
  console.log(
    `[fluid] base=${opts.base} app=${opts.label} repo=${ctx.repo.name}(${ctx.repo.id}) head=${ctx.hash.slice(0, 7)} branch=${ctx.branch} file=${ctx.file} collapseBelow=${collapseBelow}`,
  );
  const originalSettings = await getJson(`${opts.base}/api/settings`);
  const browser = await pw.chromium.launch({ ...(exe === null ? {} : { executablePath: exe }), headless: !opts.headed });
  const cells = [...routeCells(ctx), ...(opts.states ? stateCells(ctx) : [])].filter(
    (c) => opts.only === null || opts.only.some((n) => c.name.includes(n)),
  );
  const results = [];
  try {
    for (const theme of opts.themes) {
      await putJson(`${opts.base}/api/settings`, { theme });
      // 回读确认（node fetch 不带缓存；带 cache-buster 以防中间层缓存）
      const applied = await getJson(`${opts.base}/api/settings?t=${Date.now()}`);
      if (applied.theme !== theme) throw new Error(`主题设置未生效：期望 ${theme}，/api/settings 返回 ${applied.theme}`);
      for (const width of opts.widths) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        const pageErrors = [];
        const benignErrors = [];
        page.on('pageerror', (error) => {
          // 良性噪声（Monaco 的 diff worker 被取消，判据见 classifyPageError）单独记：
          // 它每次都发生（本轮 3 个含 Monaco 的格子 × 6 档 × 2 主题 = 36 格），混在「页面 JS 异常」
          // 清单里会把真正要看的东西淹掉；分开记既不丢证据，也不再污染日志。
          if (classifyPageError(error) === 'benign') benignErrors.push(String(error.message).slice(0, 140));
          else pageErrors.push(String(error.message).slice(0, 140));
        });
        // 本格的 HTTP 异常（4xx/5xx 与请求失败）：只在**判红时**用作诊断 ——
        // 就绪超时要能区分「页面接口真的失败了（该红）」与「只是慢（预算不够）」，否则下次还是只能猜。
        const httpIssues = [];
        page.on('response', (response) => {
          if (response.status() >= 400 && httpIssues.length < 5) httpIssues.push(`${response.status()} ${response.url().slice(0, 100)}`);
        });
        page.on('requestfailed', (request) => {
          if (httpIssues.length < 5) httpIssues.push(`requestfailed ${request.failure()?.errorText ?? ''} ${request.url().slice(0, 100)}`);
        });
        for (const cell of cells) {
          // setup **只做一次、在尝试循环之外**，因此它必须满足一条硬要求：**跨导航存活**。
          // 现有三个 setup 全是 `route` / `stubJson`（注册在 page 上，重试时重新 goto 仍然有效，
          // 重复注册只会叠加处理器 → 故不能放进循环里重复注册）。
          // 但将来若有人加一个「改页面状态」的 setup（点开关、填表单、滚到某处…），整格重跑时会**没有
          // 重新执行它**，那一格就是在与首轮不同的页面上被判定 —— 静默跳过，不会报错。
          // 加这种 setup 时必须把它挪进下面的尝试循环（或改成在 prepareCell 之后执行一次）。
          if (cell.setup !== undefined) await cell.setup(page);
          // 一格最多跑两次：第一次若被**环境中断**（见 isStall）就整格重来一次（重新导航 + 完整就绪门 +
          // 全部断言与测量），结论类失败不重试。两次都没过照样判红；尝试次数与首轮原因写进产物。
          let record = null;
          let stallReason = null;
          for (let attempt = 1; attempt <= MAX_CELL_ATTEMPTS; attempt += 1) {
            pageErrors.length = 0;
            benignErrors.length = 0;
            httpIssues.length = 0;
            record = { app: opts.label, theme, width, cell: cell.name, kind: cell.kind ?? 'route' };
            try {
              // 就绪门 + 主题门**一起**做（prepareCell）：主题门里若发生整页重载，就绪门会被整套重跑，
              // 避免量到「刚重载、数据还没到」的空页并判绿（Fix round 2 的回归修复）。
              const prepared = await prepareCell(page, opts.base + cell.path, cell, theme, opts.timeout, opts.base);
              const notReady = prepared.error;
              const themeProbe = prepared.themeProbe;
              record.readyItems = prepared.count;
              let extra = null;
              if (notReady === null && cell.interact !== undefined) await cell.interact(page);
              if (notReady === null && cell.verify !== undefined) extra = await cell.verify(page);
              if (notReady === null && cell.after !== undefined) extra = await cell.after(page);
              if (notReady === null && (cell.name === 'browse' || cell.name === 'log-select')) {
                extra = await assertPanes(page, width, collapseBelow);
              }
              // 按路由的密度断言与溢出断言**同一时刻、同一页面状态**下取样（interact 之后）：
              // 弹窗态 / 展开态格子的密度也要被看到。期望值由路由表决定（设置页 14，其余 12）。
              const density =
                notReady === null ? await assertDensity(page, cell, cell.density === 'default' ? 14 : 12) : null;
              record.density = density;
              const overflow = await assertNoPageOverflow(page, theme, themeProbe);
              if (notReady !== null) {
                overflow.status = 'fail';
                overflow.reason = notReady;
              }
              if (overflow.themeStatus === 'fail') {
                overflow.status = 'fail';
                overflow.reason = `${overflow.reason ?? ''} | ${overflow.themeReason}`.trim();
              }
              if (extra !== null && extra.status === 'fail') {
                overflow.status = 'fail';
                overflow.reason = `${overflow.reason ?? ''} | 例外断言: ${extra.reason}`.trim();
              }
              // 密度错档是**结论**：与溢出、例外断言同级参与判定（见 isStall 的永不重试清单）
              if (density !== null && density.status === 'fail') {
                overflow.status = 'fail';
                overflow.reason = `${overflow.reason ?? ''} | 密度断言: ${density.reason}`.trim();
              }
              Object.assign(record, overflow, { extra });
            } catch (error) {
              record.status = 'fail';
              record.scrollWidth = record.scrollWidth ?? null;
              record.clientWidth = record.clientWidth ?? null;
              record.reason = `执行异常：${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
            }
            // HTTP 异常只在判红时并入失败原因（判绿时它只是背景噪声，例如 favicon 404）
            if (httpIssues.length > 0 && record.status === 'fail') {
              record.httpIssues = [...httpIssues];
              record.reason = `${record.reason ?? ''} | 本格 HTTP 异常：${record.httpIssues.slice(0, 3).join('、')}`.trim();
            }
            if (attempt === 1 && isStall(record)) {
              stallReason = record.reason;
              record = null;
              console.log(`[fluid] ${theme}/${width}px ${cell.name}: 首轮被环境中断，重跑这一格（${String(stallReason).slice(0, 100)}）`);
              continue;
            }
            break;
          }
          if (record === null) throw new Error('unreachable: 单元格尝试循环没有产生结果');
          if (stallReason !== null) {
            record.attempts = MAX_CELL_ATTEMPTS;
            record.firstAttemptReason = stallReason;
          }
          if (pageErrors.length > 0) record.pageErrors = pageErrors.splice(0, pageErrors.length);
          if (benignErrors.length > 0) record.pageErrorsBenign = benignErrors.splice(0, benignErrors.length);
          results.push(record);
        }
        await context.close();
        const inBlock = results.filter((r) => r.theme === theme && r.width === width);
        const bad = inBlock.filter((r) => r.status === 'fail');
        // 重试过的格子在**人读的那一行**里也要看得见：否则「重试后通过」与「一次通过」在这一行完全相同。
        const retriedHere = inBlock.filter((r) => r.attempts === MAX_CELL_ATTEMPTS);
        console.log(
          `[fluid] ${opts.label} ${theme} ${width}px: ${cells.length - bad.length}/${cells.length} 通过` +
            (bad.length === 0 ? '' : `  失败: ${bad.map((b) => b.cell).join(', ')}`) +
            (retriedHere.length === 0
              ? ''
              : `  重试: ${retriedHere.map((r) => `${r.cell}(${r.status === 'pass' ? '重试后通过' : '两次均失败'})`).join(', ')}`),
        );
      }
    }
  } finally {
    await browser.close();
    // 主题属于用户配置：验收脚本跑完必须还原
    await putJson(`${opts.base}/api/settings`, { theme: originalSettings.theme ?? 'dark' });
    console.log(`[fluid] 已恢复主题设置为 ${originalSettings.theme ?? 'dark'}`);
  }
  report(results, opts);
  return results;
}

/** 汇总：逐条列失败（含精确 scrollWidth/clientWidth 与越界元素），并按需落 JSON / Markdown 矩阵 */
function report(results, opts) {
  const failed = results.filter((r) => r.status === 'fail');
  console.log('\n================ 汇总 ================');
  console.log(`应用: ${opts.label}  主题: ${opts.themes.join('/')}  宽度: ${opts.widths.join('/')}`);
  console.log(`断言格: ${results.length - failed.length}/${results.length} 通过`);
  if (failed.length === 0) {
    console.log('全部通过：六档 × 路由 × 主题的页面级横向溢出均为 0。');
  } else {
    for (const r of failed) {
      console.log(`  ✗ ${r.theme}/${r.width}px ${r.cell}: ${r.reason}`);
      console.log(
        `      scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth} 内容级就绪命中=${r.readyItems ?? '—'}` +
          (r.density === null || r.density === undefined
            ? ''
            : ` 密度=期望${r.density.expected}px/实测主导${r.density.count12 >= r.density.count14 ? 12 : 14}px（12px ${r.density.count12} 个、14px ${r.density.count14} 个）`),
      );
      for (const o of r.offenders ?? []) {
        console.log(`      越界元素: <${o.tag}> right=${o.right} width=${o.width} testid=${o.testid} text=${JSON.stringify(o.text)}`);
      }
    }
  }
  const withErrors = results.filter((r) => (r.pageErrors ?? []).length > 0);
  if (withErrors.length > 0) {
    console.log(`\n页面 JS 异常（不参与判定，仅记录）: ${withErrors.length} 格`);
    const uniq = [...new Set(withErrors.flatMap((r) => r.pageErrors))];
    for (const message of uniq.slice(0, 8)) console.log(`  - ${message}`);
  }
  const benign = results.filter((r) => (r.pageErrorsBenign ?? []).length > 0);
  if (benign.length > 0) {
    const uniq = [...new Set(benign.flatMap((r) => r.pageErrorsBenign))];
    console.log(`\n页面 JS 异常（良性噪声：已按判据过滤，不参与判定）: ${benign.length} 格`);
    console.log(`  判据: ${BENIGN_PAGE_ERROR_RULE}`);
    console.log(`  涉及格: ${[...new Set(benign.map((r) => r.cell))].map((n) => `${n}×${benign.filter((r) => r.cell === n).length}`).join('、')}`);
    for (const message of uniq.slice(0, 8)) console.log(`  - ${message}`);
  }
  // 内容级就绪命中数的**跨档一致性**：命中数不止打印，还要被看一眼 —— 同一格在六档 × 两主题下
  // 应当命中同样多的条目（各档反复测得的同一批夹具数据）；数字不同即说明某些档量到的是另一种页面状态。
  // 只告警不判红：可见行数在虚拟化列表下可能随宽度变化，判红会把正常波动变成噪声。
  const byCell = new Map();
  for (const r of results) {
    if (r.readyItems === null || r.readyItems === undefined) continue;
    if (!byCell.has(r.cell)) byCell.set(r.cell, new Set());
    byCell.get(r.cell).add(r.readyItems);
  }
  const unstable = [...byCell.entries()].filter(([, counts]) => counts.size > 1);
  if (unstable.length > 0) {
    console.log('\n内容级就绪命中数不一致（告警，不参与判定）:');
    for (const [name, counts] of unstable) console.log(`  - ${name}: ${[...counts].sort((a, b) => a - b).join(' / ')}`);
  }
  // 环境中断重试的**逐格披露**：哪些格子重试过、重试后是绿是红、首轮到底报了什么。
  // 有了这一段，「重试过的绿」不会被误读成「一次通过的绿」。
  const retried = results.filter((r) => r.attempts === MAX_CELL_ATTEMPTS);
  if (retried.length > 0) {
    const recovered = retried.filter((r) => r.status === 'pass').length;
    console.log(`\n环境中断重试（判据见 isStall；首轮失败原因逐格列出）: ${retried.length} 格 —— 重试后通过 ${recovered} 格 / 两次均失败 ${retried.length - recovered} 格`);
    for (const r of retried) {
      console.log(`  - ${r.theme}/${r.width}px ${r.cell}: ${r.status === 'pass' ? '重试后通过' : '两次均失败'}｜首轮：${String(r.firstAttemptReason ?? '').slice(0, 140)}`);
    }
  }
  // 按路由的**密度断言**结果逐格可见：期望档、各宽度的实测主导字号、12px/14px 两档计数。
  // 没有这一段，「密度档位对不对」只存在于明细 JSON 里 —— 而本轮的 Critical 缺陷正是
  // 「溢出矩阵全绿、密度却整条路由错档」，判定必须和证据一起出现在人读的产出里。
  // `no-sample`（该格无可见文本节点）单独列出：它不判红，但**逐格披露**，不允许静默跳过。
  const densityRows = results.filter((r) => r.density !== null && r.density !== undefined);
  if (densityRows.length > 0) {
    console.log('\n按路由的密度断言（判据 = 该格文本的**主导**字号；期望 compact 12px / 设置页 14px）:');
    for (const name of [...new Set(densityRows.map((r) => r.cell))]) {
      const rows = densityRows.filter((r) => r.cell === name);
      const expected = rows[0].density.expected;
      const perWidth = opts.widths
        .map((w) => {
          const row = rows.find((r) => r.width === w);
          if (row === undefined) return '—';
          if (row.density.status === 'no-sample') return '无样本';
          return `${row.density.count12 >= row.density.count14 ? 12 : 14}`;
        })
        .join('/');
      const counts = opts.widths
        .map((w) => {
          const row = rows.find((r) => r.width === w);
          return row === undefined ? null : `${w}:${row.density.count12}/${row.density.count14}`;
        })
        .filter((v) => v !== null)
        .join(' ');
      const bad = rows.filter((r) => r.density.status === 'fail').length;
      console.log(
        `  ${bad === 0 ? '✅' : `❌ ${bad} 格`} ${name.padEnd(34)} 期望 ${expected}px  各档主导 ${perWidth}  （12px/14px 计数 ${counts}）`,
      );
    }
    const noSample = densityRows.filter((r) => r.density.status === 'no-sample');
    if (noSample.length > 0) {
      console.log(`\n密度未被断言（.monaco-editor 之外没有 12px/14px 文本节点，有界重采后仍无；逐格列出，不判红也不静默跳过）: ${noSample.length} 格`);
      for (const r of noSample.slice(0, 12)) console.log(`  - ${r.theme}/${r.width}px ${r.cell}`);
    }
  }
  if (opts.json !== null) {
    writeFileSync(resolve(ROOT, opts.json), JSON.stringify({ app: opts.label, widths: opts.widths, themes: opts.themes, results }, null, 2));
    console.log(`[fluid] 明细已写入 ${opts.json}`);
  }
  if (opts.matrix !== null) {
    writeFileSync(resolve(ROOT, opts.matrix), buildMatrix(results, opts));
    console.log(`[fluid] 矩阵已写入 ${opts.matrix}`);
  }
  if (failed.length > 0) process.exitCode = 1;
}

/** 把失败原因压成能塞进表格单元格的一小段（换行会拆掉 Markdown 表格，竖线会拆掉列） */
function shortReason(reason) {
  const text = String(reason ?? '').replace(/\s+/g, ' ').replace(/\|/g, '｜').trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/**
 * 矩阵单元格的渲染。三条口径必须在这里落实，否则矩阵会**说假话**：
 *   1. 重试过（`attempts === 2`）的格子加 `↻` —— 否则「重试后通过」与「一次通过」在矩阵里一模一样；
 *   2. **没有测量结果 ≠ 溢出 0**：就绪门/导航失败时 `scrollWidth`/`clientWidth` 是 `null`，
 *      旧写法把它渲染成 `❌ null>null`，会被读成「量出一个奇怪的溢出」。这里改成显式「未测量」+ 原因；
 *   3. **量到数字但没有溢出**（例外断言 / 主题门 / 内容门判红）也不能写成 `❌ sw>cw` ——
 *      那会渲染成 `❌ 480>480`，读者会以为「480 溢出了 480」；这类红单独记作「非溢出失败」+ 原因。
 */
function renderMatrixCell(hit) {
  if (hit === undefined) return '—';
  const retried = hit.attempts === MAX_CELL_ATTEMPTS ? '↻' : '';
  if (hit.status === 'pass') return `✅${retried}`;
  const measured =
    hit.scrollWidth !== null && hit.scrollWidth !== undefined && hit.clientWidth !== null && hit.clientWidth !== undefined;
  if (!measured) return `❌ 未测量${retried}（${shortReason(hit.reason)}）`;
  if (hit.scrollWidth > hit.clientWidth + OVERFLOW_TOLERANCE) return `❌ ${hit.scrollWidth}>${hit.clientWidth}${retried}`;
  return `❌ 非溢出失败${retried}（${shortReason(hit.reason)}）`;
}

/** 生成「行=断言格 / 列=宽度」的 Markdown 矩阵，供报告直接引用 */
function buildMatrix(results, opts) {
  const cellNames = [...new Set(results.map((r) => r.cell))];
  const lines = [
    `# 横向溢出断言矩阵（${opts.label}）`,
    '',
    `断言：\`documentElement.scrollWidth <= clientWidth + 1\``,
    '',
    '本轮的判定**含按路由的密度断言**（该格文本的主导基准字号：compact 12px / 设置页 14px，判据见 `assertDensity()`）——',
    '它参与判定且**不参与重试**，故矩阵里的 `❌ 非溢出失败（…密度断言…）` 是密度错档，不是溢出；逐格密度实测见',
    '汇总的「按路由的密度断言」一节与明细 JSON 的 `density` 字段。',
    '',
    '记号：`✅` 一次通过；`✅↻` 首轮被**环境中断**、整格重跑一次后通过（明细 JSON 里 `attempts=2`，判据见 `isStall()`）；',
    '`❌ sw>cw` **已测量并溢出** —— 结论，永不重试；`❌ 非溢出失败（原因）` 量到了数字但**没有**横向溢出，',
    '红的是例外断言 / 主题门 / 内容门（矩阵不把它写成溢出）；`❌ 未测量（原因）` 该格**没有拿到测量值**',
    '（就绪门 / 导航失败），**不代表溢出 0**，原因写在括注里；`—` 该格本轮没有结果（脚本未跑到）。',
    '',
  ];
  for (const theme of opts.themes) {
    lines.push(`## ${theme}`, '', `| 断言格 | ${opts.widths.map((w) => `${w}px`).join(' | ')} |`);
    lines.push(`|---|${opts.widths.map(() => '---').join('|')}|`);
    for (const name of cellNames) {
      const row = opts.widths.map((w) => renderMatrixCell(results.find((r) => r.cell === name && r.theme === theme && r.width === w)));
      lines.push(`| ${name} | ${row.join(' | ')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 截图模式

/**
 * 截图：360/768/1440 × 明暗，沿用既有命名 responsive-<width>[-light]-<page>.png。
 * 既有同名文件属于**早前冒烟轮次**的证据（会被 e2e 文档引用），不覆盖：
 * 命中同名时改用 responsive-<width>[-light]-<page>-fluid.png 区分本轮的度量。
 */
async function runShots(opts, pw, exe) {
  const ctx = await loadFixture(opts.base, opts.repo);
  const shotsDir = join(ROOT, 'docs', 'shots');
  mkdirSync(shotsDir, { recursive: true });
  const originalSettings = await getJson(`${opts.base}/api/settings`);
  const browser = await pw.chromium.launch({ ...(exe === null ? {} : { executablePath: exe }), headless: !opts.headed });
  const q = encodeURIComponent;
  const pages = [
    ['log', `/repos/${ctx.repo.id}`],
    ['log-select', `/repos/${ctx.repo.id}?select=${ctx.hash}`],
    ['log-compare', `/repos/${ctx.repo.id}?compare=${ctx.branch}`],
    ['browse', `/repos/${ctx.repo.id}/browse?rev=${ctx.hash}`],
    ['diff', `/repos/${ctx.repo.id}/diff?file=${q(ctx.file)}&from=${ctx.prevHash}&to=${ctx.hash}`],
    ['settings', `/repos/${ctx.repo.id}/settings`],
    ['status', `/repos/${ctx.repo.id}/status`],
    ['console', `/repos/${ctx.repo.id}/console`],
    ['blame', `/repos/${ctx.repo.id}/blame?file=${q(ctx.file)}`],
    ['submodules', `/repos/${ctx.repo.id}/submodules`],
    ['patches', `/repos/${ctx.repo.id}/patches`],
  ];
  const written = [];
  const wanted = opts.pages ?? null;
  try {
    for (const theme of opts.themes) {
      await putJson(`${opts.base}/api/settings`, { theme });
      for (const width of opts.widths) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        for (const [name, path] of pages) {
          if (wanted !== null && !wanted.includes(name)) continue;
          await page.goto(opts.base + path, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
          await page.waitForTimeout(2500);
          const base = `responsive-${width}${theme === 'light' ? '-light' : ''}-${name}`;
          const file = existsSync(join(shotsDir, `${base}.png`)) ? `${base}-fluid.png` : `${base}.png`;
          await page.screenshot({ path: join(shotsDir, file) });
          written.push(file);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await putJson(`${opts.base}/api/settings`, { theme: originalSettings.theme ?? 'dark' });
  }
  console.log(`[fluid] 截图 ${written.length} 张：\n  ${written.join('\n  ')}`);
}

// ---------------------------------------------------------------- 入口

const opts = parseArgs(process.argv.slice(2));
const { module: playwrightModule, from } = loadPlaywright();
const exe = findChromium();
console.log(`[fluid] playwright 来自: ${from}`);
console.log(`[fluid] chromium: ${exe ?? '（用 playwright 默认路径）'}`);
if (opts.shotsOnly) {
  await runShots(opts, playwrightModule, exe);
} else {
  await run(opts, playwrightModule, exe);
  if (opts.shots) await runShots(opts, playwrightModule, exe);
}
