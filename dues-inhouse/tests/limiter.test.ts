import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "./db";

describe("the shared HenrikDev rate limit", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.HENRIK_RATE_LIMIT = "5";
  });
  afterAll(() => {
    delete process.env.HENRIK_RATE_LIMIT;
  });

  it("lets low-priority calls use only part of the budget, and never more than the limit in a minute", async () => {
    const { takeSlot, RateLimited } = await import("@/lib/val/limiter");
    const { db } = await import("@/lib/db");
    // Low priority: 60% of 5 is 3, then it gives up at once instead of waiting.
    for (let i = 0; i < 3; i++) await takeSlot("low");
    await expect(takeSlot("low")).rejects.toBeInstanceOf(RateLimited);
    // High priority can use the rest...
    await takeSlot("high");
    await takeSlot("high");
    // ...and then waits, or gives up if its deadline comes first.
    const started = Date.now();
    await expect(takeSlot("high", Date.now() + 500)).rejects.toBeInstanceOf(RateLimited);
    expect(Date.now() - started).toBeLessThan(400); // it saw the wait was too long, rather than sleeping
    const [{ n }] = await db()`select count(*)::int as n from api_calls where at > now() - interval '60 seconds'`;
    expect(n).toBe(5);
  });

  it("frees slots as they age out of the minute", async () => {
    const { takeSlot } = await import("@/lib/val/limiter");
    const { db } = await import("@/lib/db");
    await db()`update api_calls set at = now() - interval '61 seconds'`;
    await takeSlot("high", Date.now() + 100);
  });
});
