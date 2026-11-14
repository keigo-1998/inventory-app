import { redirect } from "next/navigation";

// はじめの画面。ダッシュボードができるまでは商品一覧を開く
export default function Home() {
  redirect("/items");
}
