/**
 * 忽略配置功能：.gitignore 与 .git/info/exclude 的读、整写、单路径幂等追加，以及内建模板。
 * 两个文件均按"不存在 → 空串/创建"处理；exclude 定位 .git/info/exclude（目录缺失时先建）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ServiceError, type IgnoreAddBody, type IgnoreContents, type IgnorePutBody, type IgnoreTemplate } from '@rebased/contracts';

/** 忽略目标：gitignore = 仓库根 .gitignore；exclude = .git/info/exclude */
type IgnoreTarget = 'gitignore' | 'exclude';

/**
 * target → 仓库内相对路径。
 * 常规仓库 .git 为目录；子模块/工作树下 .git 是文件，此处路径不通（ENOTDIR）——
 * 属常规场景外边界，v1 接受（契约只规约 .git/info/exclude 这一布局）。
 */
const IGNORE_PATHS: Record<IgnoreTarget, string> = {
  gitignore: '.gitignore',
  exclude: join('.git', 'info', 'exclude'),
};

function ignoreFileOf(repoPath: string, target: IgnoreTarget): string {
  return join(repoPath, IGNORE_PATHS[target]);
}

function readOrEmpty(file: string): string {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export async function getIgnore(repoPath: string): Promise<IgnoreContents> {
  return {
    gitignore: readOrEmpty(ignoreFileOf(repoPath, 'gitignore')),
    exclude: readOrEmpty(ignoreFileOf(repoPath, 'exclude')),
  };
}

/** 整写目标文件（不存在则创建；exclude 先建 .git/info/ 目录），返回刷新视图 */
export async function putIgnore(repoPath: string, body: IgnorePutBody): Promise<IgnoreContents> {
  const file = ignoreFileOf(repoPath, body.target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body.content, 'utf8');
  return getIgnore(repoPath);
}

/**
 * 追加 '/<path>' 行（path 原样、不转义）到 .gitignore（契约固定 target=.gitignore）：
 * 文件不存在则创建；末尾无换行先补换行；幂等判定 = 文件逐行 trim 后等于 /<path> 则视为已存在、不重复追加。
 * 字符集收紧（§2.5）：路径含换行/回车/控制字符 → INVALID_QUERY（防经 path 注入多行 .gitignore 规则）。
 */
export async function addIgnore(repoPath: string, body: IgnoreAddBody): Promise<IgnoreContents> {
  if (/[\r\n\0\u0001-\u001f]/.test(body.path)) {
    throw new ServiceError('INVALID_QUERY', '忽略路径不合法：不能包含换行或控制字符');
  }
  const file = ignoreFileOf(repoPath, 'gitignore');
  const line = `/${body.path}`;
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (before.split('\n').some((l) => l.trim() === line)) return getIgnore(repoPath);

  mkdirSync(dirname(file), { recursive: true });
  const separator = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  writeFileSync(file, `${before}${separator}${line}\n`, 'utf8');
  return getIgnore(repoPath);
}

/**
 * 内建忽略模板（常量表）：内容为可直接落盘的 ignore 规则文本。
 * - node：Node.js 项目——依赖目录、构建产物、日志、环境变量等；
 * - python：Python 项目——字节码缓存、虚拟环境、构建产物等；
 * - general：通用模板——操作系统杂项文件、IDE/编辑器目录。
 */
const IGNORE_TEMPLATES: IgnoreTemplate[] = [
  {
    id: 'node',
    name: 'Node.js',
    content: [
      '# Node.js 依赖与构建产物',
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '*.log',
      '.env',
      '.env.*',
      '!.env.example',
    ].join('\n') + '\n',
  },
  {
    id: 'python',
    name: 'Python',
    content: [
      '# Python 字节码与虚拟环境',
      '__pycache__/',
      '*.py[cod]',
      '.venv/',
      'venv/',
      '*.egg-info/',
      'build/',
      'dist/',
      '.pytest_cache/',
      '.mypy_cache/',
      '.ruff_cache/',
      '.coverage',
      'htmlcov/',
    ].join('\n') + '\n',
  },
  {
    id: 'general',
    name: '通用',
    content: [
      '# 操作系统杂项',
      '.DS_Store',
      'Thumbs.db',
      'desktop.ini',
      '# IDE 与编辑器',
      '.idea/',
      '.vscode/',
      '*.swp',
      '.project',
      '.classpath',
      '.settings/',
    ].join('\n') + '\n',
  },
];

export function getIgnoreTemplates(): IgnoreTemplate[] {
  // 常量表只读共享：返回浅拷贝，防调用方变异污染内建表
  return IGNORE_TEMPLATES.map((t) => ({ ...t }));
}
