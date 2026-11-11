import Link from "next/link";
import { fmtDate, fmtSigned, MOVEMENT_LABELS } from "@/lib/format";

export function MovementTable({
  rows,
  hideItem,
}: {
  rows: { id: number; type: string; quantity: number; after: number; operator: string | null; note: string | null; createdAt: Date; item: { id: number; name: string; unit: string } }[];
  hideItem?: boolean;
}) {
  if (rows.length === 0) return <p className="muted">履歴はありません。</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>日時</th>
          {!hideItem && <th>品目</th>}
          <th>区分</th>
          <th className="num">増減</th>
          <th className="num">処理後</th>
          <th>担当者</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.id}>
            <td className="nowrap">{fmtDate(m.createdAt, true)}</td>
            {!hideItem && <td><Link href={`/items/${m.item.id}`}>{m.item.name}</Link></td>}
            <td><span className={`tag tag-${m.type}`}>{MOVEMENT_LABELS[m.type] ?? m.type}</span></td>
            <td className={`num ${m.quantity < 0 ? "text-danger" : "text-ok"}`}>{fmtSigned(m.quantity)}</td>
            <td className="num">{m.after} {m.item.unit}</td>
            <td>{m.operator ?? "-"}</td>
            <td className="muted">{m.note ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
