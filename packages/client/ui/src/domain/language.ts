/**
 * 文件扩展名 → Monaco 语言 id。
 * 做什么：只读代码视图要按文件类型高亮，而 Monaco 的 `language` 是显式的——不给就只能纯文本。
 * 怎么做：一张小表覆盖仓库里常见的那几种；查不到就返回 `undefined`，由调用方退到 `plaintext`
 *       （不猜、不硬塞一个错的语法，错的高亮比没有高亮更误导）。
 * 注意：这里的 id 必须是 Monaco **内置支持**的语言（monaco-editor 自带 basic-languages 那些），
 *       写一个它不认识的 id 不会报错，但也完全没有高亮。
 */

/** 扩展名（小写、不含点）→ Monaco 语言 id */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  properties: 'ini',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  swift: 'swift',
  scala: 'scala',
  dart: 'dart',
  r: 'r',
};

/**
 * 按文件路径猜 Monaco 语言 id：取最后一个 `.` 之后的后缀（小写）。
 * 无后缀（如 `Makefile`）与未收录的后缀都返回 undefined，由调用方用 plaintext。
 */
export function languageForPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return LANGUAGE_BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
}
