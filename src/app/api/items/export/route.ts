import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const items = await db.item.findMany({ include: { category: true }, orderBy: { code: "asc" } });
  const header = ["品番", "品名", "カテゴリ", "単位", "在庫数", "発注点", "保管場所", "備考", "更新日時"];
  const lines = items.map((i) =>
    [i.code, i.name, i.category?.name, i.unit, i.quantity, i.minQuantity, i.location, i.note, i.updatedAt.toISOString()].map(esc).join(","),
  );
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="items.csv"`,
    },
  });
}
