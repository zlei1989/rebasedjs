/**
 * 剪贴板写入：把一段文本拷进系统剪贴板，返回是否真的写成功。
 * 做什么：所有「点击复制」的统一出口——调用方据返回值决定要不要显示「已复制」，
 *        写失败时**不谎报成功**（浏览器拒绝剪贴板权限、非安全上下文都要能被区分出来）。
 * 怎么做：先走 `navigator.clipboard.writeText`（异步、需要安全上下文），失败或不存在时
 *        退回 `document.execCommand('copy')` + 一个临时 textarea（http 页面 / 旧浏览器的兜底）。
 *        兜底手法与 antd 内部实现一致（antd 的 `_util/copy` 未对外导出，故此处自持一份）。
 * 注意：不抛异常——调用方按布尔值分支，避免每个复制点各写一遍 try/catch。
 */

/** execCommand 兜底：临时 textarea + 选中 + 复制（jsdom 无 execCommand 时返回 false） */
function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const area = document.createElement('textarea');
  area.value = text;
  // 固定在视口内但不可见：display:none 或 visibility:hidden 的节点选不中，复制会失败
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  area.setAttribute('readonly', '');
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒 / 非安全上下文：落到下面的兜底，不在这里返回
    }
  }
  return execCommandCopy(text);
}
