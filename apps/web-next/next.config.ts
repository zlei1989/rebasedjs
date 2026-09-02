/** Next 配置：monorepo 源码直引（transpilePackages 编译 workspace TS 包） */
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@rebased/ui', '@rebased/client', '@rebased/contracts'],
  reactStrictMode: true,
};

export default nextConfig;
