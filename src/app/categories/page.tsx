import { db } from "@/lib/db";
import { createCategory, deleteCategory } from "@/lib/actions";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await db.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true } } } });
  return (
    <>
      <h1>カテゴリ</h1>
      <section className="card">
        <ActionForm action={createCategory} submitLabel="追加" resetOnSuccess className="form form-inline">
          <input name="name" placeholder="新しいカテゴリ名" required />
        </ActionForm>
      </section>
      <section className="card">
        <table className="table">
          <thead><tr><th>カテゴリ名</th><th className="num">品目数</th><th></th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{c._count.items}</td>
                <td className="right">
                  <ConfirmButton
                    action={deleteCategory.bind(null, c.id)}
                    confirm={`「${c.name}」を削除しますか？所属する品目は「未分類」になります。`}
                    className="btn btn-sm btn-danger"
                  >
                    削除
                  </ConfirmButton>
                </td>
              </tr>
            ))}
            {categories.length === 0 && <tr><td colSpan={3} className="muted center">カテゴリがありません</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
