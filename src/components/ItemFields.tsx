import type { Category, Item } from "@prisma/client";

export function ItemFields({ categories, item }: { categories: Category[]; item?: Item }) {
  return (
    <div className="grid-2">
      <label>
        品番 <span className="req">*</span>
        <input name="code" required defaultValue={item?.code} placeholder="例: OF-001" />
      </label>
      <label>
        品名 <span className="req">*</span>
        <input name="name" required defaultValue={item?.name} />
      </label>
      <label>
        カテゴリ
        <select name="categoryId" defaultValue={item?.categoryId ?? ""}>
          <option value="">（未分類）</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        単位 <span className="req">*</span>
        <input name="unit" required defaultValue={item?.unit ?? "個"} />
      </label>
      <label>
        発注点（この数以下で警告）
        <input name="minQuantity" type="number" min={0} required defaultValue={item?.minQuantity ?? 0} />
      </label>
      <label>
        保管場所
        <input name="location" defaultValue={item?.location ?? ""} placeholder="例: 倉庫A-1" />
      </label>
      <label className="span-2">
        備考
        <textarea name="note" rows={2} defaultValue={item?.note ?? ""} />
      </label>
    </div>
  );
}
