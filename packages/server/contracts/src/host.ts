/**
 * host 规范化：URL/主机串 → 小写主机名（去协议/端口/路径/尾斜杠）。
 * auth 账户存查与 token 注入的唯一键约定——防「存了查不到」（P2-H 终审建议）。
 * 非法输入不抛错，原样小写返回（保证同一输入永远得到同一键，存查一致）。
 */
export function normalizeHost(input: string): string {
  const s = input.trim().toLowerCase();
  // 带协议的 URL（http/https/ssh/git 等）：交给 URL 解析，hostname 自动去端口/用户/路径并小写
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try {
      return new URL(s).hostname;
    } catch {
      return s;
    }
  }
  // scp 式 SSH（git@github.com:user/repo.git）或裸主机串：
  // 先去 user@ 前缀（@ 出现在首个 / 之前才算用户），再截到首个 : 或 /（端口/路径剥离）
  let rest = s;
  const at = rest.indexOf('@');
  const slash = rest.indexOf('/');
  if (at !== -1 && (slash === -1 || at < slash)) {
    rest = rest.slice(at + 1);
  }
  const end = rest.search(/[:/]/);
  return end === -1 ? rest : rest.slice(0, end);
}
