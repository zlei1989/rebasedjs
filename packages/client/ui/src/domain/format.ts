/**
 * 日期格式化工具：直接取 ISO 串的本地日期/时间字段，
 * 不经过 Date 解析——输出确定，不依赖运行环境时区与区域设置。
 */

/** 提交日期：ISO → "YYYY-MM-DD HH:mm"（无法匹配时原样返回） */
export function formatCommitDate(dateIso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dateIso);
  return m ? `${m[1]} ${m[2]}` : dateIso;
}

/** 详情面板作者行：对齐 Java CommitDetailsPanel 的 "{0} on {1} at {2}" 格式 */
export function formatAuthorLine(author: string, dateIso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dateIso);
  if (!m) return `${author} on ${dateIso}`;
  return `${author} on ${m[1]} at ${m[2]}`;
}
