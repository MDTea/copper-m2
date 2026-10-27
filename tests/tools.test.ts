// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCost,
  calculateCostInput,
  checkAvailability,
  checkAvailabilityInput,
  copperTools,
  getPrices,
  listProducts,
} from "@/lib/copper/assistant/tools";
import { readInventory } from "@/lib/copper/inventory";

vi.mock("@/lib/copper/inventory", () => ({ readInventory: vi.fn() }));
const mockInventory = vi.mocked(readInventory);

const row = (product: string, color: string, units: number, ship = "2026-11-14") => ({
  sku: `${product}-${color}`,
  product,
  color,
  units_in_stock: units,
  next_shipment: ship,
});

describe("calculate_cost", () => {
  it("adds a device and a yearly plan", () => {
    const result = calculateCost({
      products: ["copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 2,
    });
    expect(result.totalUsd).toBe(307);
    expect(result.lines.map((l) => l.usd)).toEqual([149, 158]);
  });

  it("counts Copper Plus once for two devices", () => {
    const result = calculateCost({
      products: ["copper-home", "copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 1,
    });
    expect(result.lines).toHaveLength(3);
    expect(result.totalUsd).toBe(377);
  });

  it("bills monthly as 12 payments a year, rounded to cents", () => {
    const result = calculateCost({
      products: [],
      plan: "copper-plus",
      billing: "monthly",
      years: 2,
    });
    expect(result.totalUsd).toBe(191.76);
  });

  it("adds no line for the free plan", () => {
    const result = calculateCost({
      products: ["copper-notes"],
      plan: "free",
      billing: "monthly",
      years: 3,
    });
    expect(result.lines).toHaveLength(1);
    expect(result.totalUsd).toBe(129);
  });

  it("rejects input outside its contract", () => {
    const ok = {
      products: ["copper-home"],
      plan: "free",
      billing: "annual",
      years: 1,
    };
    expect(calculateCostInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, products: ["copper-max"] },
      { ...ok, plan: "gold" },
      { ...ok, years: 0 },
      { ...ok, years: 6 },
      { ...ok, years: 1.5 },
      { ...ok, products: Array(6).fill("copper-home") },
    ]) {
      expect(calculateCostInput.safeParse(bad).success).toBe(false);
    }
  });
});

describe("get_products and get_prices", () => {
  it("lists every product with its colors", () => {
    const { products } = listProducts();
    expect(products.map((p) => p.id)).toEqual(["copper-home", "copper-notes"]);
    expect(products[1].colors).toEqual(["Brushed Copper", "Desert Sand", "Night Sky"]);
  });

  it("lists every product and plan price", () => {
    const prices = getPrices();
    expect(prices.products).toHaveLength(2);
    expect(prices.plans.map((p) => p.id)).toEqual(["free", "copper-plus"]);
  });

  it("exposes exactly four described tools", () => {
    expect(Object.keys(copperTools).sort()).toEqual([
      "calculate_cost",
      "check_availability",
      "get_prices",
      "get_products",
    ]);
    for (const t of Object.values(copperTools)) expect(t.description).toBeTruthy();
  });
});

describe("check_availability", () => {
  beforeEach(() => {
    mockInventory.mockReset();
    mockInventory.mockResolvedValue([
      row("Copper Notes", "Brushed Copper", 310, "2026-11-13"),
      row("Copper Notes", "Desert Sand", 9, "2026-11-13"),
      row("Copper Notes", "Night Sky", 0, "2026-11-14"),
      row("Copper Home", "Patina Teal", 6, "2026-11-06"),
    ]);
  });

  it("maps units to in stock, low stock and back-ordered", async () => {
    const result = await checkAvailability({ product: "copper-notes" });
    expect(result).toEqual({
      status: "ok",
      product: "Copper Notes",
      colors: [
        { color: "Brushed Copper", stock: "in_stock", restockDate: null },
        { color: "Desert Sand", stock: "low_stock", restockDate: null },
        { color: "Night Sky", stock: "backordered", restockDate: "2026-11-14" },
      ],
    });
  });

  it("matches one color in any capitalization, answering in the catalog's", async () => {
    const result = await checkAvailability({ product: "copper-home", color: "patina TEAL" });
    expect(result).toMatchObject({
      status: "ok",
      colors: [{ color: "Patina Teal", stock: "low_stock" }],
    });
  });

  it("says not_a_color for a color the product doesn't come in, even without stock", async () => {
    mockInventory.mockResolvedValue(null);
    const result = await checkAvailability({ product: "copper-notes", color: "Patina Teal" });
    expect(result).toEqual({
      status: "not_a_color",
      product: "Copper Notes",
      color: "Patina Teal",
      colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
    });
  });

  it("says unavailable, with no stock words, when stock can't be read", async () => {
    mockInventory.mockResolvedValue(null);
    const result = await checkAvailability({ product: "copper-home" });
    expect(result.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toMatch(/in_stock|low_stock|backordered/);
  });

  it("reads stock fresh every time", async () => {
    await checkAvailability({ product: "copper-notes" });
    await checkAvailability({ product: "copper-notes" });
    expect(mockInventory).toHaveBeenCalledTimes(2);
  });

  it("only accepts Copper products", () => {
    expect(checkAvailabilityInput.safeParse({ product: "copper-max" }).success).toBe(false);
    expect(checkAvailabilityInput.safeParse({ product: "copper-home" }).success).toBe(true);
  });
});
