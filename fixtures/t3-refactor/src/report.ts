import { readFile } from "node:fs/promises";
import { join } from "node:path";

type Order = {
  region: string;
  rep: string;
  amount: number;
  status: "paid" | "pending";
};

type RegionTotal = {
  region: string;
  orders: number;
  revenue: number;
};

// This starter deliberately keeps parsing, calculation, formatting, and printing
// together. The refactor exercise separates the pure report calculation from IO.
// The command output below is the behavior that must remain stable.
const reportTitle = "Paid sales report";
const reportRule = "=================";

const inputPath = join(import.meta.dir, "../data/orders.json");

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function paidOrders(orders: Order[]): Order[] {
  return orders.filter((order) => order.status === "paid");
}

function totalsByRegion(orders: Order[]): RegionTotal[] {
  const totals = new Map<string, RegionTotal>();

  for (const order of orders) {
    const current = totals.get(order.region) ?? {
      region: order.region,
      orders: 0,
      revenue: 0,
    };
    current.orders += 1;
    current.revenue += order.amount;
    totals.set(order.region, current);
  }

  return [...totals.values()].sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return a.region.localeCompare(b.region);
  });
}

function renderRegion(total: RegionTotal): string {
  const orderLabel = total.orders === 1 ? "order" : "orders";
  return `${total.region.padEnd(6)} ${String(total.orders).padStart(2)} ${orderLabel.padEnd(6)} ${formatMoney(total.revenue).padStart(6)}`;
}

async function main(): Promise<void> {
  const rawInput = await readFile(inputPath, "utf8");
  const orders = JSON.parse(rawInput) as Order[];
  const paid = paidOrders(orders);
  const totals = totalsByRegion(paid);
  const totalRevenue = paid.reduce((sum, order) => sum + order.amount, 0);

  console.log(reportTitle);
  console.log(reportRule);
  console.log("Region Orders Revenue");
  for (const total of totals) {
    console.log(renderRegion(total));
  }
  console.log("-----------------");
  console.log(`Total: ${formatMoney(totalRevenue)} across ${paid.length} paid orders`);
}

await main();
