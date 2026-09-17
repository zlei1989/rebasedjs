/**
 * Diff 查看器：MonacoDiffView 包装 + 模式/呈现选项。
 * UX 对齐 #4：默认并排（side-by-side）；忽略空白（默认不忽略，对齐 Java DEFAULT）；
 * staged/工作区切换由调用方持有状态（受控组件）。
 * 呈现选项（P2 收取，#4 域「word diff/同步滚动/折叠/上下文行数」的 Web 落点——对齐 Java TextDiffSettingsHolder：
 * word diff 与同步滚动由 Monaco diff 引擎内建（行内词级高亮 + 双侧联动滚动），无需开关；
 * 「上下文行数」→ **未变更区折叠**（Monaco 差异编辑器的 hideUnchangedRegions：数值 = 只展开改动区附近 N 行，
 * 「全部显示」= 整文件展开，对齐 Java context lines 默认 5）；「空白字符」→ renderWhitespace；「自动换行」→ wordWrap。
 *
 * **没有「折叠」勾选框**（2026-09-16 用户口径删除）：Monaco 的 folding 是**代码折叠**（行号槽里把函数/括号块收起来），
 * 与差异编辑器的「未变更区折叠」（hideUnchangedRegions）是两件事。本仓为绕开打包链路的语言服务缺陷把四个语言服务
 * 的 worker 能力全关了（见 base/monaco-lazy 文件头），没有折叠区提供者 ⇒ 实测把未变更区折叠关掉后，
 * 编辑器里 `[class*="folding"]` 与折叠图标都是 0，勾选框开着关着画面完全一样（死控件）。故删掉它，
 * 未变更区折叠由「上下文行数」一个控件独占表达（用户口径：两者既然不是一个意思，就删掉那个勾选框）。
 *
 * 已知限制：monaco-lazy 的 effect 依赖仅 [language]，options 变化不会重建编辑器——
 * 这里用 key 随全部开关变化强制重挂载，保证 renderSideBySide/ignoreTrimWhitespace/hideUnchangedRegions/wordWrap 等生效。
 *
 * **工具条每一项各落一个 localStorage 键**（2026-09-16 用户口径：每个属性一个 key，新开标签页读最后一次要求）：
 * 并排/行内、忽略空白、自动换行、空白字符、上下文行数都是**显示偏好**（怎么看差异），不是「在看什么」——
 * 故不进 URL（分享链接不该带上别人的阅读习惯），只记本机。逐项读写见 base/stored-preference。
 * 顺带把「忽略空白」从受控改成自有状态：它只影响 Monaco 的渲染选项，服务端取数从不带它（staged 那类
 * 会改变请求的参数仍由调用方受控），调用方原本也只是各存一份 useState——两处各存反而会互相不一致。
 */
import { Flex, Segmented, Select, Switch, Tooltip, Typography } from 'antd';
import type { FileVersions } from '@rebased/contracts';
import { MonacoDiffView, type MonacoDiffLoader } from '../base/monaco-diff-view';
import { parseBoolean, useStoredPreference } from '../base/stored-preference';

export interface DiffViewerProps {
  versions: FileVersions;
  staged: boolean;
  onToggleStaged?: (staged: boolean) => void;
  language?: string;
  /** from/to 定提交对比模式（true 时隐藏 staged/工作区切换——该模式与 staged 互斥，服务端 XOR 校验会给 400） */
  fromTo?: boolean;
  /**
   * 呈现方式的**初值**（缺省 true = 并排），只在**本机没存过**时生效：用户显式选过并排/行内之后，
   * 新标签页按本机偏好开场（窄宿主给的 false 不再覆盖用户的选择）。
   * 窄宿主（日志页快照栏的变更差异标签）传 false 直接以「行内」开场——并排两栏每侧只剩几十字符。
   */
  initialSideBySide?: boolean;
  /** 测试注入点：替换 monaco 加载器（默认懒加载真实 monaco） */
  loader?: MonacoDiffLoader;
}

/** 上下文行数选项：'all'=全部显示（hideUnchangedRegions 关闭）；数值=仅变更区 + N 行上下文（对齐 Java context lines，默认 5） */
const CONTEXT_LINES = [
  { value: 'all' as const, label: '全部显示' },
  { value: '0' as const, label: '上下文 0 行' },
  { value: '2' as const, label: '上下文 2 行' },
  { value: '5' as const, label: '上下文 5 行' },
  { value: '7' as const, label: '上下文 7 行' },
  { value: '15' as const, label: '上下文 15 行' },
];

/** 上下文行数的合法值域（存量值越界/来自旧版本一律回落默认 5 行） */
const CONTEXT_VALUES = CONTEXT_LINES.map((o) => o.value);

/** 本机偏好键：`rebased.diff.*` 与 log-page 的列宽记忆（`rebased.log.*`）同一命名口径 */
const STORAGE_KEYS = {
  sideBySide: 'rebased.diff.sideBySide',
  ignoreWhitespace: 'rebased.diff.ignoreWhitespace',
  autoWrap: 'rebased.diff.autoWrap',
  renderWhitespace: 'rebased.diff.renderWhitespace',
  contextLines: 'rebased.diff.contextLines',
} as const;

export function DiffViewer({
  versions,
  staged,
  onToggleStaged,
  language,
  fromTo,
  initialSideBySide = true,
  loader,
}: DiffViewerProps): React.ReactNode {
  // 五项工具条选项各自一个键（见文件头）：初值取本机存量值，改一次就写回
  const [sideBySide, setSideBySide] = useStoredPreference(STORAGE_KEYS.sideBySide, initialSideBySide, parseBoolean);
  const [ignoreWhitespace, setIgnoreWhitespace] = useStoredPreference(STORAGE_KEYS.ignoreWhitespace, false, parseBoolean);
  // 自动换行默认关：与 Java 版一致（代码对比默认横向滚动），长行需要折行时由用户显式打开
  const [wordWrap, setWordWrap] = useStoredPreference(STORAGE_KEYS.autoWrap, false, parseBoolean);
  const [renderWhitespace, setRenderWhitespace] = useStoredPreference<'none' | 'all'>(
    STORAGE_KEYS.renderWhitespace,
    'none',
    (raw) => (raw === 'all' || raw === 'none' ? raw : null),
  );
  const [contextLines, setContextLines] = useStoredPreference<'all' | '0' | '2' | '5' | '7' | '15'>(
    STORAGE_KEYS.contextLines,
    '5',
    (raw) => (CONTEXT_VALUES.includes(raw as (typeof CONTEXT_VALUES)[number]) ? (raw as (typeof CONTEXT_VALUES)[number]) : null),
  );

  /* 未变更区折叠：数值 → 只展开改动区附近 N 行；「全部显示」→ 整文件展开（不下发 hideUnchangedRegions）。
     它是这件事的唯一控件（原先那个「折叠」勾选框接的是 Monaco 的代码折叠 folding，本仓无折叠区提供者、
     实测没有任何可见效果，已按用户口径删除——见文件头）。 */
  const contextOptions =
    contextLines === 'all'
      ? {}
      : { hideUnchangedRegions: { enabled: true as const, contextLineCount: Number(contextLines) } };
  return (
    <Flex vertical gap={8} style={{ height: '100%' }}>
      <Flex align="center" gap={12} wrap="wrap">
        <Tooltip title="差异呈现方式：左右两栏逐行对照，或单栏里成对显示增删行">
          <Segmented
            size="small"
            options={[
              { label: '并排', value: 'side' },
              { label: '行内', value: 'inline' },
            ]}
            value={sideBySide ? 'side' : 'inline'}
            onChange={(v) => setSideBySide(v === 'side')}
          />
        </Tooltip>
        {/* from/to 模式：对比对象是两定提交，staged/工作区切换无意义且服务端互斥（400），隐藏 */}
        {fromTo ? null : (
          <Tooltip title="对比哪一侧的改动：未暂存的工作区改动，或已加入暂存区的内容">
            <Segmented
              options={[
                { label: '工作区', value: 'worktree' },
                { label: '已暂存', value: 'staged' },
              ]}
              value={staged ? 'staged' : 'worktree'}
              onChange={(v) => onToggleStaged?.(v === 'staged')}
            />
          </Tooltip>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="忽略空白差异：开启后缩进与行尾空白的改动不计入差异，只看实质内容变化">
            <Switch
              size="small"
              data-testid="diff-ignore-ws"
              checked={ignoreWhitespace}
              onChange={setIgnoreWhitespace}
            />
          </Tooltip>
          忽略空白
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="自动换行：开启后过长的行折到栏宽内显示（按词边界折行），不必左右拖动横向滚动条">
            <Switch
              size="small"
              data-testid="diff-wrap"
              checked={wordWrap}
              onChange={setWordWrap}
            />
          </Tooltip>
          自动换行
        </span>
        <Tooltip title="空白字符渲染：选择是否把空格与制表符以可见符号标出（只影响显示，不改内容）">
          <Select
            data-testid="diff-whitespace"
            size="small"
            style={{ width: 130 }}
            value={renderWhitespace === 'all' ? 'all' : 'none'}
            options={[
              { value: 'none', label: '空白不显示' },
              { value: 'all', label: '空白显示' },
            ]}
            onChange={(v) => setRenderWhitespace(v === 'all' ? 'all' : 'none')}
          />
        </Tooltip>
        <Tooltip title="未变更区折叠：选数值只展开改动区附近的 N 行（长文件里快速定位改动），选「全部显示」整文件展开、不折叠">
          <Select
            data-testid="diff-context"
            size="small"
            style={{ width: 140 }}
            value={contextLines}
            options={CONTEXT_LINES}
            onChange={setContextLines}
          />
        </Tooltip>
        <Typography.Text type="secondary">
          word diff / 同步滚动为 Monaco 内建
        </Typography.Text>
      </Flex>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MonacoDiffView
          // monaco-lazy 不会因 options 变化重建：key 变化强制重挂载使新 options 生效
          key={`${sideBySide ? 'side' : 'inline'}-${ignoreWhitespace ? 'nowrap' : 'raw'}-fold-${contextLines}-${wordWrap ? 'wrap' : 'nowrapline'}-${renderWhitespace}`}
          original={versions.before}
          modified={versions.after}
          language={language}
          options={{
            renderSideBySide: sideBySide,
            ignoreTrimWhitespace: ignoreWhitespace,
            readOnly: true,
            renderWhitespace,
            // 自动换行：'on' 按词边界折行（长行不必横向滚动）；'off' 保持横向滚动
            wordWrap: wordWrap ? 'on' : 'off',
            ...contextOptions,
          }}
          loader={loader}
        />
      </div>
    </Flex>
  );
}
