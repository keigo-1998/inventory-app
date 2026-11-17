// 「いま有効な販売」の条件。取り消した販売と、返品された販売は「売れた」に数えない
// （商品の残り個数・売却済みかどうか・山の成績は、この条件で数える）
import type { Prisma } from "@prisma/client";

export const LIVE_SALE: Prisma.SaleWhereInput = {
  cancelledAt: null,
  adjustments: { none: { kind: "return", cancelledAt: null } },
};
