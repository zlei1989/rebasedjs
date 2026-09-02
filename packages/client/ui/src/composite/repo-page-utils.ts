/**
 * RepoPage 工具：路径相对用户主目录显示（UX 对齐 #3 路径副文本，Java RecentProjectPanel user-home 相对化）。
 * ui 运行在浏览器，无法读 os.homedir()——homeDir 由调用方容器（web-next/web-koa）注入。
 */

/** 统一分隔符为正斜杠并去尾部斜杠，便于跨平台比较 */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * path 位于 homeDir 下时返回 `~/…` 相对形式，否则原样返回。
 * 仅按目录边界匹配（`/home/user2` 不属于 `/home/user`）；不做大小写折叠，保持确定性。
 */
export function relativeToHome(path: string, homeDir: string): string {
  const home = normalize(homeDir);
  if (!home) return path;
  const target = normalize(path);
  if (target === home) return '~';
  if (target.startsWith(`${home}/`)) return `~${target.slice(home.length)}`;
  return path;
}
