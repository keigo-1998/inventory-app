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
          <Link key={m.href} href={m.href} className={path === m.href ? "on" : ""}>{m.label}</Link>
        ) : (
          <a key={m.href} className="soon" title="まだ作っていません">{m.label}</a>
        ),
      )}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  const items = [MENU[0], MENU[1], { href: "/sales", label: "販売", icon: "¥", ready: true }, MENU[2]];
  return (
    <nav className="bottom">
      {items.map((m) =>
        m.ready ? (
          <Link key={m.href} href={m.href} className={path === m.href ? "on" : ""}><b>{m.icon}</b>{m.label}</Link>
        ) : (
          <a key={m.href} className="soon" title="まだ作っていません"><b>{m.icon}</b>{m.label}</a>
        ),
      )}
    </nav>
  );
}

/** 右上のボタン（パソコン）と、右下の「＋ 登録」ボタン（スマホ） */
export function HeaderButtons() {
  return (
    <div className="hright">
      <Link className="btn" href="/sales">販売を記録</Link>
      <Link className="btn primary" href="/items/new">＋ 商品を登録</Link>
    </div>
  );
}
export function Fab() {
  const path = usePathname();
  if (path === "/items/new") return null; // 登録画面では隠す
  return <Link className="fab" href="/items/new">＋ 登録</Link>;
}
