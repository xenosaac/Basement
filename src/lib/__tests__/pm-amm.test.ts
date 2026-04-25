import { describe, it, expect } from "vitest";
import {
  phi,
  Phi,
  PhiInv,
  yOfZ,
  xOfZ,
  zOf,
  priceYes,
  priceNo,
  poolValue,
  initialReserves,
  buy,
  sell,
  DEFAULT_L,
} from "../pm-amm";

describe("pm-amm Gaussian primitives", () => {
  it("φ(0) = 1/√(2π) ≈ 0.39894", () => {
    expect(phi(0)).toBeCloseTo(0.39894, 4);
  });

  it("Φ(0) = 0.5", () => {
    expect(Phi(0)).toBeCloseTo(0.5, 6);
  });

  it("Φ(z) symmetric: Φ(-z) = 1 - Φ(z)", () => {
    for (const z of [0.1, 0.5, 1, 1.5, 2, 3]) {
      expect(Phi(-z)).toBeCloseTo(1 - Phi(z), 6);
    }
  });

  it("Φ⁻¹(Φ(z)) ≈ z (round-trip)", () => {
    for (const z of [-2, -1, -0.3, 0.3, 1, 2]) {
      expect(PhiInv(Phi(z))).toBeCloseTo(z, 5);
    }
  });

  it("Φ⁻¹(0.5) = 0", () => {
    expect(PhiInv(0.5)).toBeCloseTo(0, 6);
  });
});

describe("pm-amm reserve curves", () => {
  it("y(0) = x(0) = L·φ(0) (initial state at P=0.5)", () => {
    const L = 100;
    const expected = L * phi(0);
    expect(yOfZ(0, L)).toBeCloseTo(expected, 6);
    expect(xOfZ(0, L)).toBeCloseTo(expected, 6);
  });

  it("invariant: (y-x)·Φ((y-x)/L) + L·φ((y-x)/L) - y = 0 holds for various z", () => {
    const L = 100;
    for (const z of [-2, -1, -0.5, 0, 0.5, 1, 2]) {
      const x = xOfZ(z, L);
      const y = yOfZ(z, L);
      const d = y - x;
      const inv = d * Phi(d / L) + L * phi(d / L) - y;
      expect(Math.abs(inv)).toBeLessThan(1e-9);
    }
  });

  it("zOf inverts the reserve curves", () => {
    const L = 100;
    for (const z of [-1.5, 0, 0.5, 1.2]) {
      const x = xOfZ(z, L);
      const y = yOfZ(z, L);
      expect(zOf(x, y, L)).toBeCloseTo(z, 6);
    }
  });

  it("priceYes = Φ(z) at the corresponding state", () => {
    const L = 100;
    for (const z of [-1, 0, 0.5, 1.5]) {
      const x = xOfZ(z, L);
      const y = yOfZ(z, L);
      expect(priceYes(x, y, L)).toBeCloseTo(Phi(z), 6);
      expect(priceNo(x, y, L)).toBeCloseTo(1 - Phi(z), 6);
    }
  });

  it("poolValue V = L·φ(z); maximized at z=0", () => {
    const L = 100;
    const v0 = poolValue(xOfZ(0, L), yOfZ(0, L), L);
    expect(v0).toBeCloseTo(L * phi(0), 6);
    // Decreases monotonically as |z| increases
    expect(poolValue(xOfZ(1, L), yOfZ(1, L), L)).toBeLessThan(v0);
    expect(poolValue(xOfZ(-1, L), yOfZ(-1, L), L)).toBeLessThan(v0);
  });
});

describe("pm-amm buy / sell mechanics", () => {
  it("initial pool seeded at L·φ(0)", () => {
    const init = initialReserves(100);
    expect(init.x).toBeCloseTo(100 * phi(0), 6);
    expect(init.y).toBeCloseTo(100 * phi(0), 6);
  });

  it("buy YES with $C: y grows by exactly C", () => {
    const init = initialReserves(100);
    const r = buy(init.x, init.y, "YES", 5);
    expect(r.newY - init.y).toBeCloseTo(5, 4);
    expect(r.sharesBought).toBeGreaterThan(0);
    expect(r.cost).toBe(5);
    expect(r.newPriceYes).toBeGreaterThan(0.5);
  });

  it("buy NO with $C: x grows by exactly C", () => {
    const init = initialReserves(100);
    const r = buy(init.x, init.y, "NO", 5);
    expect(r.newX - init.x).toBeCloseTo(5, 4);
    expect(r.sharesBought).toBeGreaterThan(0);
    expect(r.newPriceNo).toBeGreaterThan(0.5);
  });

  it("buy → sell same shares = exact round-trip", () => {
    const init = initialReserves(100);
    const b = buy(init.x, init.y, "YES", 10);
    const s = sell(b.newX, b.newY, "YES", b.sharesBought);
    expect(s.proceeds).toBeCloseTo(10, 6);
    // State should return to initial
    expect(s.newX).toBeCloseTo(init.x, 6);
    expect(s.newY).toBeCloseTo(init.y, 6);
  });

  it("repeated buys monotonically raise YES price", () => {
    const init = initialReserves(100);
    let x = init.x;
    let y = init.y;
    let prevP = 0.5;
    for (let i = 0; i < 5; i++) {
      const r = buy(x, y, "YES", 5);
      expect(r.newPriceYes).toBeGreaterThanOrEqual(prevP);
      prevP = r.newPriceYes;
      x = r.newX;
      y = r.newY;
    }
  });

  it("avg price > marginal start price (slippage)", () => {
    // Buying $20 at 50/50 with L=$100 → meaningful slippage
    const init = initialReserves(100);
    const r = buy(init.x, init.y, "YES", 20);
    // avgPrice = cost / shares; should exceed 0.5 (start) but be < newPriceYes (end)
    expect(r.avgPrice).toBeGreaterThan(0.5);
    expect(r.avgPrice).toBeLessThan(r.newPriceYes);
  });

  it("uses DEFAULT_L from env when L omitted", () => {
    expect(DEFAULT_L).toBeGreaterThan(0);
    const init = initialReserves();
    expect(init.x).toBeCloseTo(DEFAULT_L * phi(0), 6);
  });

  it("rejects non-positive amounts", () => {
    const init = initialReserves(100);
    expect(() => buy(init.x, init.y, "YES", 0)).toThrow();
    expect(() => buy(init.x, init.y, "YES", -1)).toThrow();
    expect(() => sell(init.x, init.y, "YES", 0)).toThrow();
    expect(() => sell(init.x, init.y, "YES", -1)).toThrow();
  });
});
