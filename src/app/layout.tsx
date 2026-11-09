import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "GEO", description: "品牌 AI 回答测量与事实管理" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
