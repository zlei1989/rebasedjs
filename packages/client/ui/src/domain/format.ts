/**
 * 日期格式化工具：默认直接取 ISO 串的日期/时间字段，不经过 Date 解析——输出确定，不依赖运行环境时区与区域设置。
 * 例外：带 `Z`（UTC 标记）的串——命令执行日志、存档文件 mtime、托管平台 API 时间戳都是这种——
 * 必须先按本机时区换算再展示，否则页面显示的墙上时间与用户本地时钟差一个时区（实测差 8 小时）。
 * 第二个例外是 {@link formatRelativeTime}：相对时间**必须**解析时刻才能算差值（它不展示日期本身，
 * 不受"截取字符串"那条口径约束）。
 */

/** 补零：不依赖区域设置，避免 toLocaleString 在不同环境给出不同格式 */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 按本机时区把时刻渲染为 "YYYY-MM-DD HH:mm" */
function localWallClock(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 提交日期：ISO → "YYYY-MM-DD HH:mm"（无法匹配时原样返回） */
export function formatCommitDate(dateIso: string): string {
  // 带 Z 的串是 UTC 时刻，换算到本机时区再展示；带偏移（git 的 author date）或裸时间的串保持原样截取
  if (dateIso.endsWith('Z')) {
    const at = new Date(dateIso);
    // 不可解析的 Z 串不猜：原样返回，交由调用方按原文展示
    return Number.isNaN(at.getTime()) ? dateIso : localWallClock(at);
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dateIso);
  return m ? `${m[1]} ${m[2]}` : dateIso;
}

/**
 * 相对时间缩写（注解行时间列用）：`刚刚` / `N分钟前` / `N小时前` / `N天前` / `N月前` / `N年前`。
 *
 * 分档（与用户点名的示例对齐）：<60 秒「刚刚」；<60 分「N分钟前」；<24 小时「N小时前」；
 * **≤31 天**「N天前」；<365 天「N月前」（N = ⌊天/30⌋，至少 1，故 32 天 = 1月前）；≥365 天「N年前」（N = ⌊天/365⌋）。
 * 为什么按 31 天切而不是 30 天：口径里「31天前」与「1月前」都要能出现，30 天切会让 31 天变成「1月前」而
 * 永远看不到「31天前」。
 *
 * 两个边界：**未来时刻**（时钟偏差、时区异常的提交）按「刚刚」，不显示负数；**无法解析的串原样返回**
 * （与 formatCommitDate 同口径：不猜、不硬编一个时间）。
 *
 * `now` 可注入：测试据此断言绝对分档，不受运行时刻影响。值随时间推移会"变旧"，
 * 调用方在重渲染时自然刷新——本仓**不**为此挂定时器（每秒/每分钟重渲染上千行不值得）。
 */
export function formatRelativeTime(dateIso: string, now: number = Date.now()): string {
  const at = Date.parse(dateIso);
  if (Number.isNaN(at)) return dateIso;
  const diff = now - at;
  if (diff < 60_000) return '刚刚';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days <= 31) return `${days}天前`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30))}月前`;
  return `${Math.floor(days / 365)}年前`;
}

/** 详情面板作者行的**时间部分**："2026-09-01 at 14:30"（无法解析时给原串，不猜） */
export function formatAuthorTimestamp(dateIso: string): string {
  const [date, time] = formatCommitDate(dateIso).split(' ');
  if (date === undefined || time === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return dateIso;
  }
  return `${date} at ${time}`;
}

/** 详情面板作者行：对齐 Java CommitDetailsPanel 的 "{0} on {1} at {2}" 格式（日期不可解析时退化为 "{0} on {原串}"） */
export function formatAuthorLine(author: string, dateIso: string): string {
  return `${author} on ${formatAuthorTimestamp(dateIso)}`;
}

/**
 * 作者标识（复制值口径）：`姓名 <邮箱>`，与 git 的 author 字段同形——
 * 复制出来可直接喂 `git log --author=`、粘进 PR 或邮件头。
 * 邮箱缺失（某些后端/夹具只给姓名）时只给姓名，不留下一个空的尖括号。
 */
export function formatAuthor(author: string, authorEmail?: string): string {
  const email = authorEmail?.trim() ?? '';
  return email === '' ? author : `${author} <${email}>`;
}
