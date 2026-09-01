/**
 * Tailwind CSS v3 配置
 *
 * - preflight 禁用：项目已有 normalize.css，避免与 antd-mobile 全局样式冲突
 * - content 扫描 app/ 和 components/ 下的 TSX 文件
 */
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
