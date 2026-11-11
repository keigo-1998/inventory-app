import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "在庫・備品管理システム" };

const NAV = [
  { href: "/", label: "ダッシュボード" },
  { href: "/items", label: "品目一覧" },
  { href: "/loans", label: "貸出管理" },
  { href: "/movements", label: "入出庫履歴" },
  { href: "/categories", label: "カテゴリ" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="header">
          <Link href="/" className="brand">
            在庫・備品管理
          </Link>
          <nav className="nav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
