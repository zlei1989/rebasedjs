/**
 * ESLint 9 flat config — 统一管理 TS/TSX 规则与格式化。
 * 采用渐进收敛策略：stylistic/import 规则初始为 warn，模块修复后升级 error。
 *
 * 格式规则（@stylistic/import/unused/sort）来自根目录共享的 eslint.shared.ts，
 * 与 agent-sdk / protocol-sdk 保持一致；本文件仅叠加 web 特有的规则。
 *
 * 不使用 @eslint/eslintrc 的 FlatCompat（ESLint 9 下插件循环引用会导致崩溃），
 * 而是直接使用 eslint-config-next 提供的原生 flat config。
 */
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import tailwindcss from "eslint-plugin-tailwindcss";
import { sharedFormatRules } from "../../eslint.shared";

const eslintConfig = tseslint.config(
  // Next.js 官方规则 (core-web-vitals + typescript)
  ...nextVitals,
  ...nextTs,
  // TypeScript 严格类型检查（在 recommended 之上启用类型检查规则）
  ...tseslint.configs.strictTypeChecked,
  // 启用 projectService 以支持类型检查（strictTypeChecked 不包含此项）
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  // 统一格式规则 — 与 SDK 包共享（@stylistic + import-x + unused-imports + sort-imports）
  ...sharedFormatRules,
  // Tailwind CSS — class 排序 + 冲突检测 + 简写建议
  ...tailwindcss.configs["flat/recommended"],
  // TypeScript 专项规则
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      // allowNumber: 日志中常嵌入数值型 ID、坐标等，强制 String() 包裹反而降低可读性
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  // 忽略目录（与 nextTs 中已有的 ignores 合并）
  {
    ignores: [".next/", "node_modules/", "scripts/", "public/", "*.config.*", "coverage/"],
  },
);

export default eslintConfig;
