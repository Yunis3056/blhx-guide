import type { NextConfig } from 'next'

/**
 * §4.6 的静态导出配置，每一项都是验收条件：
 * - `output: 'export'` + `images.unoptimized`：静态导出没有 /_next/image 服务端，
 *   不关优化器则 next/image 产出的 URL 在 Pages 上是 404
 * - `trailingSlash: true`：Pages 上 /ship/20502/index.html 的可访问形式
 * - `env` 只透传 `NEXT_PUBLIC_IMG_BASE` 一个名字：全文档的图片基址只有这一个口径，
 *   多出第二个名字就会出现 `undefined/...` 的 src
 *
 * 这个文件必须与 package.json 同目录（apps/web/），放仓库根不会被读取。
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  /**
   * ESLint 由 `pnpm lint`（turbo 的 web#lint 任务）单独跑，不在 next build 里重复一遍：
   * §4.6 的守卫规则写在 apps/web/eslint.config.mjs，两边都只有一份配置。
   * Next 的构建期类型检查保持开启——它已经在 build 阶段抓到过真实错误。
   */
  eslint: { ignoreDuringBuilds: true },
  generateBuildId: async () => process.env.CF_PAGES_COMMIT_SHA ?? 'dev',
  env: { NEXT_PUBLIC_IMG_BASE: process.env.NEXT_PUBLIC_IMG_BASE },
}

export default nextConfig
