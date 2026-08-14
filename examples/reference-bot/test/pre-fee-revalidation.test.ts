import { describe, expect, it } from "vitest";
import { decidePreFeeRevalidation, preFeeRevalidationWindow } from "../src/strategy/pre-fee-revalidation.js";
import { quote } from "./fixtures.js";

const pricedQuote = (side: "yes" | "no") => quote({
  side,
  grossAmount: "100",
  economics: { ...quote().economics, grossAmount: "100", projectedWinningPayout: "200" },
  closingProtection: { ...quote().closingProtection, closingStartsAt: 1_000 },
});
const prices = (yes: number, no: number) => ({
  yes: { tokenId: "yes", bidBps: yes - 100, askBps: yes, spreadBps: 100, observedAtMs: 1 },
  no: { tokenId: "no", bidBps: no - 100, askBps: no, spreadBps: 100, observedAtMs: 1 },
});

describe("pre-closing-fee Polymarket revalidation", () => {
  it("opens_on_the_window_boundary_and_closes_on_the_submission_buffer_boundary", () => {
    const input = { quote: pricedQuote("yes"), leadSeconds: 20, submissionBufferSeconds: 3 };
    expect(preFeeRevalidationWindow({ ...input, now: 979 })).toMatchObject({ eligible: false, reason: "pre_fee_revalidation_not_open" });
    expect(preFeeRevalidationWindow({ ...input, now: 980 })).toMatchObject({ eligible: true, reason: "pre_fee_revalidation_window_open" });
    expect(preFeeRevalidationWindow({ ...input, now: 997 })).toMatchObject({ eligible: false, reason: "pre_fee_revalidation_window_closed" });
  });

  it("holds_only_when_the_original_side_still_wins_the_original_entry_tests", () => {
    const input = { heldSide: "yes" as const, quotes: [pricedQuote("yes"), pricedQuote("no")] as const, entryEdgeBps: 500, minimumHoldReturnBps: 100, minimumWinProfitBps: 100 };
    expect(decidePreFeeRevalidation({ ...input, prices: prices(6_000, 3_800) })).toMatchObject({ action: "hold", reason: "polymarket_pre_fee_signal_confirmed" });
    expect(decidePreFeeRevalidation({ ...input, prices: prices(3_800, 6_000) })).toMatchObject({ action: "sell", reason: "polymarket_pre_fee_signal_changed" });
    expect(decidePreFeeRevalidation({ ...input, prices: prices(5_100, 4_900), entryEdgeBps: 500 })).toMatchObject({ action: "sell", reason: "polymarket_pre_fee_signal_changed" });
  });
});
