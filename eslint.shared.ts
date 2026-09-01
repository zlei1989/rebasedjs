/**
 * 共享 ESLint flat 配置 + 分层边界规则工厂。
 * 边界即架构：api/core 禁框架；ui 禁 client/api/apps；client 禁 apps；apps 间互禁。
 */
import type { Linter } from 'eslint';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import tsParser from '@typescript-eslint/parser';

export type PackageName = 'core' | 'api' | 'contracts' | 'ui' | 'client' | 'web-next' | 'web-koa';

/** 各包禁止 import 的模块名（精确名或带 * 的通配名） */
const FORBIDDEN: Record<PackageName, string[]> = {
  core: ['next', 'next/*', 'koa', 'react', 'react-dom'],
  api: ['next', 'next/*', 'koa', 'react', 'react-dom'],
  contracts: [],
  ui: ['@rebased/client', '@rebased/api', '@rebased/web-next', '@rebased/web-koa', 'next/navigation'],
  client: ['@rebased/web-next', '@rebased/web-koa'],
  'web-next': ['@rebased/web-koa'],
  'web-koa': ['@rebased/web-next'],
};

export const baseConfig: Linter.Config[] = [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/public/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser },
    plugins: { '@stylistic': stylistic, 'import-x': importX, 'unused-imports': unusedImports },
    rules: {
      '@stylistic/quotes': ['error', 'single'],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/indent': ['error', 2],
      'unused-imports/no-unused-imports': 'error',
      'import-x/no-duplicates': 'error',
    },
  },
];

function boundaryMessage(pkg: PackageName, name: string): string {
  return `[分层边界] ${pkg} 禁止 import ${name}（见 docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md §3.3）`;
}

/**
 * 把禁止名单展开为 no-restricted-imports 的 patterns 组：
 * 精确名匹配自身，非通配名另加「名/*」子路径组；'next/*' 这类已带 * 的保持通配。
 * （paths.name 为精确匹配，'next/*' 等死条目会被 'next/headers' 绕过，故改用 patterns.group 的 glob。）
 */
function toGroups(pkg: PackageName, names: string[]): Array<{ group: string; message: string }> {
  return names.flatMap((name) => {
    const message = boundaryMessage(pkg, name);
    if (name.endsWith('*')) return [{ group: name, message }];
    return [
      { group: name, message },
      { group: `${name}/*`, message },
    ];
  });
}

/** 按包名生成带边界约束的配置（与 baseConfig 合并使用） */
export function withBoundary(pkg: PackageName): Linter.Config[] {
  const names = FORBIDDEN[pkg];
  if (names.length === 0) return [...baseConfig];
  return [
    ...baseConfig,
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: toGroups(pkg, names).map(({ group, message }) => ({ group: [group], message })),
          },
        ],
      },
    },
  ];
}
