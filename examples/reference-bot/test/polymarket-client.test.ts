import { describe, expect, it } from "vitest";
import { PolymarketClient } from "../src/polymarket-client.js";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("read-only Polymarket executable prices", () => {
  it("selects_best_bid_and_ask_for_the_exact_token", async () => {
    const now = 1_800_000_000_000;
    const client = new PolymarketClient("https://clob.example", async (input) => {
      expect(String(input)).toContain("token_id=up-token");
      return response({ asset_id: "up-token", timestamp: String(now - 100), bids: [{ price: "0.55" }, { price: "0.57" }], asks: [{ price: "0.62" }, { price: "0.60" }] });
    }, () => now);
    await expect(client.executablePrice("up-token", { timeoutMs: 100, maximumAgeMs: 1_000, maximumSpreadBps: 500 }))
      .resolves.toEqual({ tokenId: "up-token", bidBps: 5700, askBps: 6000, spreadBps: 300, observedAtMs: now - 100 });
  });

  it.each([
    [{ asset_id: "wrong", timestamp: "1800000000000", bids: [{ price: "0.5" }], asks: [{ price: "0.6" }] }, "validation"],
    [{ asset_id: "token", timestamp: "1799999990000", bids: [{ price: "0.5" }], asks: [{ price: "0.6" }] }, "source_stale"],
    [{ asset_id: "token", timestamp: "1800000000000", bids: [{ price: "0.1" }], asks: [{ price: "0.9" }] }, "quote_blocked"],
    [{ asset_id: "token", timestamp: "1800000000000", bids: [], asks: [{ price: "0.6" }] }, "source_unavailable"],
  ])("fails_closed_for_identity_freshness_spread_or_depth", async (body, code) => {
    const client = new PolymarketClient("https://clob.example", async () => response(body), () => 1_800_000_000_000);
    await expect(client.executablePrice("token", { timeoutMs: 100, maximumAgeMs: 1_000, maximumSpreadBps: 1_000 }))
      .rejects.toMatchObject({ code });
  });

  it("maximum_price_age_reaches_the_freshness_consumer", async () => {
    const client = new PolymarketClient("https://clob.example", async () => response({ asset_id: "token", timestamp: "1000", bids: [{ price: "0.5" }], asks: [{ price: "0.6" }] }), () => 2001);
    await expect(client.executablePrice("token", { timeoutMs: 100, maximumAgeMs: 1_000, maximumSpreadBps: 1_000 })).rejects.toMatchObject({ code: "source_stale" });
  });

  it("maximum_spread_reaches_the_executable_book_consumer", async () => {
    const client = new PolymarketClient("https://clob.example", async () => response({ asset_id: "token", timestamp: "2000", bids: [{ price: "0.5" }], asks: [{ price: "0.6001" }] }), () => 2000);
    await expect(client.executablePrice("token", { timeoutMs: 100, maximumAgeMs: 1_000, maximumSpreadBps: 1_000 })).rejects.toMatchObject({ code: "quote_blocked" });
  });

  it("timeout_reaches_the_request_abort_consumer", async () => {
    const client = new PolymarketClient("https://clob.example", async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(client.executablePrice("token", { timeoutMs: 5, maximumAgeMs: 1_000, maximumSpreadBps: 1_000 })).rejects.toMatchObject({ code: "source_unavailable" });
  });
});
