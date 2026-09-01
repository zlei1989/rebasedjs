import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone 模式：构建后 .next/standalone/ 为自包含部署目录（~34 MB），
  // 拷贝到服务器直接 node server.js 启动，无需 npm install。
  // 因此依赖必须用 npm 安装（pnpm 符号链接结构不兼容 standalone）。
  output: 'standalone',
  // node-sqlite3-wasm 需要外部化：其内部通过 __dirname 定位 .wasm 文件，
  // 打包会破坏 .js 与 .wasm 的相对路径关系
  serverExternalPackages: ['node-sqlite3-wasm'],
};

export default nextConfig;
