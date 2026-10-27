import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

/**
 * 阶段 1 的垂直切片：只有 1 艘船的详情页能预渲染，其余路由在阶段 2 接上。
 * 不设 metadataBase：域名要等 1.11 部署时由用户确认，现在写死等于生成错的绝对链接。
 */
export const metadata: Metadata = {
  title: { default: '碧蓝航线攻略站', template: '%s · 碧蓝航线攻略站' },
  description: '国服碧蓝航线图鉴与计算工具。数据来源为解包配置表，构建期生成静态页。',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
