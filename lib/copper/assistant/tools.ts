// Module 2: the four tools Ask Copper can use. Products and prices come from
// lib/copper/catalog.ts and stock from lib/copper/inventory.ts, so the
// chatbot never has to make them up.
// The contract for each tool is in specs/module-2/spec.md.
import { tool } from "ai";
import { z } from "zod";
import {
  getPlans,
  getProducts,
  type Plan,
  type Product,
  type ProductId,
} from "@/lib/copper/catalog";
import { readInventory } from "@/lib/copper/inventory";

export type ProductList = {
  products: {
    id: ProductId;
    name: string;
    type: string;
    priceUsd: number;
    colors: string[];
  }[];
};

export type Prices = {
  products: { id: ProductId; name: string; priceUsd: number }[];
  plans: {
    id: Plan["id"];
    name: string;
    monthlyUsd: number;
    annualUsd: number;
  }[];
};

export type CalculateCostInput = {
  products: ProductId[];
  plan: Plan["id"];
  billing: "monthly" | "annual";
  years: number;
};

export type CostBreakdown = {
  lines: { item: string; usd: number }[];
  totalUsd: number;
};

export type CheckAvailabilityInput = { product: ProductId; color?: string };

export type Stock = "in_stock" | "low_stock" | "backordered";

export type Availability =
  | {
      status: "ok";
      product: string;
      colors: { color: string; stock: Stock; restockDate: string | null }[];
    }
  | { status: "not_a_color"; product: string; color: string; colors: string[] }
  | { status: "unavailable"; message: string };

const productId = z.enum(["copper-home", "copper-notes"]);

/** Round to whole cents. */
const cents = (amount: number) => Math.round(amount * 100) / 100;

/** The catalog's spelling of a color, matched ignoring case and spacing. */
function catalogColor(product: Product, color: string): string | undefined {
  const wanted = color.trim().toLowerCase();
  return product.colors.find((c) => c.toLowerCase() === wanted);
}

/** get_products: what Copper sells and which colors each one comes in. */
export function listProducts(): ProductList {
  return {
    products: getProducts().map(({ id, name, type, priceUsd, colors }) => ({
      id,
      name,
      type,
      priceUsd,
      colors,
    })),
  };
}

/** get_prices: every product and plan price, read from the catalog. */
export function getPrices(): Prices {
  return {
    products: getProducts().map(({ id, name, priceUsd }) => ({
      id,
      name,
      priceUsd,
    })),
    plans: getPlans().map(({ id, name, monthlyUsd, annualUsd }) => ({
      id,
      name,
      monthlyUsd,
      annualUsd,
    })),
  };
}

export const calculateCostInput: z.ZodType<CalculateCostInput> = z.object({
  products: z.array(productId).max(5),
  plan: z.enum(["free", "copper-plus"]),
  billing: z.enum(["monthly", "annual"]),
  years: z.number().int().min(1).max(5),
});

/** calculate_cost: the total cost of devices plus a plan over some years. */
export function calculateCost(input: CalculateCostInput): CostBreakdown {
  const catalog = getProducts();
  const lines: CostBreakdown["lines"] = input.products.map((id) => {
    const product = catalog.find((p) => p.id === id)!;
    return { item: product.name, usd: cents(product.priceUsd) };
  });

  // Copper Plus covers the whole household, so it's one line however many devices.
  const plan = getPlans().find((p) => p.id === input.plan);
  if (plan && input.plan === "copper-plus") {
    const usd =
      input.billing === "monthly"
        ? plan.monthlyUsd * 12 * input.years
        : plan.annualUsd * input.years;
    const years = `${input.years} ${input.years === 1 ? "year" : "years"}`;
    lines.push({
      item: `${plan.name}, ${input.billing}, ${years}`,
      usd: cents(usd),
    });
  }

  return {
    lines,
    totalUsd: cents(lines.reduce((sum, line) => sum + line.usd, 0)),
  };
}

export const checkAvailabilityInput: z.ZodType<CheckAvailabilityInput> =
  z.object({
    product: productId,
    color: z.string().optional(),
  });

/** check_availability: stock for one product (or one of its colors), read fresh each time. */
export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<Availability> {
  const product = getProducts().find((p) => p.id === input.product)!;

  // A color the product doesn't come in is "not_a_color", even if stock is unreadable.
  let wanted: string | undefined;
  if (input.color !== undefined) {
    wanted = catalogColor(product, input.color);
    if (!wanted) {
      return {
        status: "not_a_color",
        product: product.name,
        color: input.color,
        colors: product.colors,
      };
    }
  }

  const rows = await readInventory();
  if (rows === null) {
    return {
      status: "unavailable",
      message: "Stock can't be checked right now. Please try again shortly.",
    };
  }

  const colors: Extract<Availability, { status: "ok" }>["colors"] = [];
  for (const color of wanted ? [wanted] : product.colors) {
    const row = rows.find(
      (r) => r.product === product.name && r.color === color,
    );
    if (!row) continue;
    const units = row.units_in_stock;
    colors.push(
      units === 0
        ? { color, stock: "backordered", restockDate: row.next_shipment }
        : units < 10
          ? { color, stock: "low_stock", restockDate: null }
          : { color, stock: "in_stock", restockDate: null },
    );
  }
  return { status: "ok", product: product.name, colors };
}

export const copperTools = {
  get_products: tool({
    description:
      "List every Copper product with its type, price and the colors it comes in (not whether a color is in stock).",
    inputSchema: z.object({}),
    execute: async () => listProducts(),
  }),
  get_prices: tool({
    description:
      "Get the current price of every Copper product and the monthly and yearly price of every plan.",
    inputSchema: z.object({}),
    execute: async () => getPrices(),
  }),
  calculate_cost: tool({
    description:
      "Work out the total cost of up to 5 devices plus a plan (free or copper-plus, billed monthly or annual) over 1 to 5 years.",
    inputSchema: calculateCostInput,
    execute: async (input) => calculateCost(input),
  }),
  check_availability: tool({
    description:
      "Check today's stock for a product, or for one of its colors: in stock, low stock, or back-ordered with its restock date.",
    inputSchema: checkAvailabilityInput,
    execute: async (input) => checkAvailability(input),
  }),
};
