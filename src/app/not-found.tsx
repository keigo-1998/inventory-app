import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card">
      <h1>ページが見つかりません</h1>
      <p><Link href="/">はじめの画面へ戻る</Link></p>
    </section>
  );
}
