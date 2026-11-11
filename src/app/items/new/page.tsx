import { db } from "@/lib/db";
import { createItem } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { ItemFields } from "@/components/ItemFields";

export const dynamic = "force-dynamic";

export default async function NewItemPage() {
  const categories = await db.category.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <h1>品目を登録</h1>
      <section className="card">
        <ActionForm action={createItem} submitLabel="登録する">
          <ItemFields categories={categories} />
          <div className="grid-2">
            <label>
              初期在庫数
              <input name="quantity" type="number" min={0} defaultValue={0} required />
            </label>
            <label>
              担当者
              <input name="operator" />
            </label>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
