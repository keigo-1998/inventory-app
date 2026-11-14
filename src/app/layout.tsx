import type { Metadata } from "next";
import { TopNav, BottomNav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = { title: "物販管理 JOYNT" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header>
          <div className="hwrap">
            <div className="logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/joynt-logo.png" alt="JOYNT" />
              <span>物販管理</span>
            </div>
            <TopNav />
            <div className="hright">
              <button className="btn" disabled title="まだ作っていません">販売を記録</button>
              <button className="btn primary" disabled title="まだ作っていません">＋ 商品を登録</button>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
