// 変更の履歴（だれが・いつ・何を変えたか）を残すための部品。
// データを変える処理は、かならずこの部品を通して ChangeLog に記録する。
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export type ChangeAction = "create" | "update" | "delete" | "restore";

/** 1件の変更を履歴に残す。before / after は変える前・後の中身 */
export async function logChange(
  tx: Tx,
  args: { table: string; recordId: number; action: ChangeAction; before?: unknown; after?: unknown; note?: string; user?: string },
) {
  await tx.changeLog.create({
    data: {
      table: args.table,
      recordId: args.recordId,
      action: args.action,
      before: args.before === undefined ? null : JSON.stringify(args.before),
      after: args.after === undefined ? null : JSON.stringify(args.after),
      note: args.note,
      user: args.user,
    },
  });
}

/** 「削除」は行を消さずに、消した日時の印を付けるだけ（ゴミ箱と同じ） */
export const notDeleted = { deletedAt: null } as const;
