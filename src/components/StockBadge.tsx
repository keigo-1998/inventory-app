export function StockBadge({ quantity, min }: { quantity: number; min: number }) {
  if (quantity === 0) return <span className="badge badge-danger">在庫切れ</span>;
  if (quantity <= min) return <span className="badge badge-warn">要発注</span>;
  return <span className="badge badge-ok">適正</span>;
}
