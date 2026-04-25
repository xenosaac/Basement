import { describe, it, expect } from "vitest";
import { isCloseMoment } from "@/lib/cron-gate";

function dateAtMinute(min: number): Date {
  // Build a UTC date at hour 12 with the given minute. Hour irrelevant for
  // the gate (it only inspects minute-of-hour).
  return new Date(Date.UTC(2026, 3, 25, 12, min, 0, 0));
}

describe("isCloseMoment", () => {
  it(":00 hits all three cadences (3min ∩ 15min ∩ 1h)", () => {
    const r = isCloseMoment(dateAtMinute(0));
    expect(r.isCloseMoment).toBe(true);
    expect(r.hits).toEqual({ c3min: true, c15min: true, c1h: true });
    expect(r.minuteOfHour).toBe(0);
  });

  it(":15 :30 :45 hit 3min + 15min", () => {
    for (const m of [15, 30, 45]) {
      const r = isCloseMoment(dateAtMinute(m));
      expect(r.isCloseMoment).toBe(true);
      expect(r.hits.c3min).toBe(true);
      expect(r.hits.c15min).toBe(true);
      expect(r.hits.c1h).toBe(false);
    }
  });

  it(":03 :06 :09 :12 :18 :21 :24 :27 hit 3min only", () => {
    for (const m of [3, 6, 9, 12, 18, 21, 24, 27]) {
      const r = isCloseMoment(dateAtMinute(m));
      expect(r.isCloseMoment).toBe(true);
      expect(r.hits.c3min).toBe(true);
      expect(r.hits.c15min).toBe(false);
      expect(r.hits.c1h).toBe(false);
    }
  });

  it("skips non-close minutes (:01 :02 :04 :05 :07 :08 ...)", () => {
    const skipMinutes = [1, 2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23];
    for (const m of skipMinutes) {
      const r = isCloseMoment(dateAtMinute(m));
      expect(r.isCloseMoment).toBe(false);
      expect(r.hits).toEqual({ c3min: false, c15min: false, c1h: false });
    }
  });

  it("counts 20 close-moment minutes per hour (every 3rd)", () => {
    let count = 0;
    for (let m = 0; m < 60; m++) {
      if (isCloseMoment(dateAtMinute(m)).isCloseMoment) count++;
    }
    // :00 :03 :06 ... :57 = 20 minutes per hour, all 15min/1h hits are subsets
    expect(count).toBe(20);
  });
});
