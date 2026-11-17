import type { Metadata } from "next";
import { TopNav, BottomNav, HeaderButtons, Fab } from "@/components/Nav";
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
            <HeaderButtons />
          </div>
        </header>
        <main>{children}</main>
        <BottomNav />
        <Fab />
      </body>
    </html>
  );
}
