import { describe, expect, it } from "vitest";
import type { ExecutableQuote } from "@stryke/sdk";
import { convergenceReached, decidePolymarketRelativeEntry } from "../src/polymarket-relative-value.js";

const quote = (side: "yes" | "no", probability: number) => ({ side, normalizedSideProbabilityBps: probability } as ExecutableQuote);
const price = (bidBps: number, askBps: number) => ({ tokenId: "token", bidBps, askBps, spreadBps: askBps - bidBps, observedAtMs: 1 });

describe("Polymarket relative-value decisions", () => {
  it("selects_either_side_at_the_exact_absolute_entry_boundary", () => {
    const prices = { yes: price(5200, 5500), no: price(4000, 4400) };
    expect(decidePolymarketRelativeEntry({ quotes: [quote("yes", 5000), quote("no", 4600)], prices, entryEdgeBps: 500 }))
      .toMatchObject({ action: "buy", side: "yes", edgeBps: 500 });
    expect(decidePolymarketRelativeEntry({ quotes: [quote("yes", 5400), quote("no", 3800)], prices, entryEdgeBps: 500 }))
      .toMatchObject({ action: "buy", side: "no", edgeBps: 600 });
  });

  it("skips_below_entry_and_exits_at_the_exact_lower_boundary", () => {
    const prices = { yes: price(5200, 5500), no: price(4000, 4400) };
    expect(decidePolymarketRelativeEntry({ quotes: [quote("yes", 5001), quote("no", 4401)], prices, entryEdgeBps: 500 }))
      .toMatchObject({ action: "skip", reason: "insufficient_polymarket_edge" });
    expect(convergenceReached({ side: "yes", strykeSellProbabilityBps: 5000, prices, exitEdgeBps: 200 }))
      .toEqual({ reached: true, remainingEdgeBps: 200 });
    expect(convergenceReached({ side: "yes", strykeSellProbabilityBps: 4999, prices, exitEdgeBps: 200 }).reached).toBe(false);
  });
});
