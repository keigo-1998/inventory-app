import { redirect } from "next/navigation";

// はじめの画面はダッシュボード
export default function Home() {
  redirect("/dashboard");
}
