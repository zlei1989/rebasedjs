/**
 * 共享 ESLint flat 配置 + 分层边界规则工厂。
 * 边界即架构：api/core 禁框架；ui 禁数据层；client 禁 apps；apps 间互禁。
 */
import type { Linter } from 'eslint';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';

export type PackageName = 'core' | 'api' | 'contracts' | 'ui' | 'client' | 'web-next' | 'web-koa';

/** 各包禁止 import 的模块（paths 传给 no-restricted-imports） */
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

/** 按包名生成带边界约束的配置（与 baseConfig 合并使用） */
export function withBoundary(pkg: PackageName): Linter.Config[] {
  const paths = FORBIDDEN[pkg];
  if (paths.length === 0) return baseConfig;
  return [
    ...baseConfig,
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: paths.map((name) => ({
              name,
              message: `[分层边界] ${pkg} 禁止 import ${name}（见 docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md §3.3）`,
            })),
          },
        ],
      },
    },
  ];
}
