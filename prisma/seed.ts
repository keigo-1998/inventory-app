import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if ((await prisma.item.count()) > 0) {
    console.log("データが既に存在するためシードをスキップしました");
    return;
  }
  const [office, it, consumable] = await Promise.all(
    ["事務用品", "IT機器", "消耗品"].map((name) => prisma.category.create({ data: { name } })),
  );
  const items = [
    { code: "OF-001", name: "A4コピー用紙（500枚）", categoryId: consumable.id, unit: "冊", quantity: 40, minQuantity: 20, location: "倉庫A-1" },
    { code: "OF-002", name: "ボールペン（黒）", categoryId: office.id, unit: "本", quantity: 8, minQuantity: 30, location: "倉庫A-2" },
    { code: "OF-003", name: "付箋 75mm", categoryId: office.id, unit: "個", quantity: 55, minQuantity: 20, location: "倉庫A-2" },
    { code: "IT-001", name: "ノートPC", categoryId: it.id, unit: "台", quantity: 5, minQuantity: 2, location: "IT保管庫" },
    { code: "IT-002", name: "プロジェクター", categoryId: it.id, unit: "台", quantity: 2, minQuantity: 1, location: "IT保管庫" },
    { code: "IT-003", name: "HDMIケーブル 2m", categoryId: it.id, unit: "本", quantity: 3, minQuantity: 5, location: "IT保管庫" },
  ];
  for (const data of items) {
    const item = await prisma.item.create({ data });
    await prisma.stockMovement.create({
      data: { itemId: item.id, type: "IN", quantity: data.quantity, after: data.quantity, operator: "システム", note: "初期登録" },
    });
  }
  console.log("サンプルデータを登録しました");
}

main().finally(() => prisma.$disconnect());
