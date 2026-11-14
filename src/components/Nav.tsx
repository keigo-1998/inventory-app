"use client";
// 上のメニュー（パソコン）と下のメニュー（スマホ）。まだ作っていない画面は薄く表示して押せないようにする
import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/dashboard", label: "ダッシュボード", icon: "▦", ready: false },
  { href: "/items", label: "商品一覧", icon: "≡", ready: true },
  { href: "/report", label: "月次レポート", icon: "▤", ready: false },
];

export function TopNav() {
  const path = usePathname();
  return (
    <nav className="top">
      {MENU.map((m) =>
        m.ready ? (
          <Link key={m.href} href={m.href} className={path.startsWith(m.href) ? "on" : ""}>{m.label}</Link>
        ) : (
          <a key={m.href} className="soon" title="まだ作っていません">{m.label}</a>
        ),
      )}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  const items = [MENU[0], MENU[1], { href: "/sales", label: "販売", icon: "¥", ready: false }, MENU[2]];
  return (
    <nav className="bottom">
      {items.map((m) =>
        m.ready ? (
          <Link key={m.href} href={m.href} className={path.startsWith(m.href) ? "on" : ""}><b>{m.icon}</b>{m.label}</Link>
        ) : (
          <a key={m.href} className="soon" title="まだ作っていません"><b>{m.icon}</b>{m.label}</a>
        ),
      )}
    </nav>
  );
}
