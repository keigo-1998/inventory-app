import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card">
      <h1>ページが見つかりません</h1>
      <p><Link href="/">ダッシュボードへ戻る</Link></p>
    </section>
  );
}
