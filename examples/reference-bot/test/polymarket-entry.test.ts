import { describe, expect, it } from "vitest";
import { quote } from "./fixtures.js";
import { executableEntryEconomics, selectEmptyMarketBootstrapEntry, selectExecutablePolymarketEntry } from "../src/strategy/polymarket-entry.js";

const price = (askBps: number) => ({ tokenId: "token", bidBps: askBps - 100, askBps, spreadBps: 100, observedAtMs: 1 });
const pricedQuote = (side: "yes" | "no", cost: string, payout: string) => quote({ side, grossAmount: cost, amount: cost, economics: { ...quote().economics, grossAmount: cost, projectedWinningPayout: payout } });

describe("executable Polymarket entry economics", () => {
  it("executable_entry_cost_uses_gross_debit_and_projected_payout", () => {
    expect(executableEntryEconomics({ quote: pricedQuote("yes", "100", "200"), price: price(6000), entryEdgeBps: 1000, minimumHoldReturnBps: 1, minimumWinProfitBps: 1 }))
      .toMatchObject({ costProbabilityBps: 5000, relativeEdgeBps: 1000, profitIfWins: 100n, holdExpectedValue: 20n, holdReturnBps: 2000, passes: true });
  });
  it("executable_entry_math_rounds_cost_up_and_returns_down", () => {
    const result = executableEntryEconomics({ quote: pricedQuote("yes", "2", "3"), price: price(6667), entryEdgeBps: 0, minimumHoldReturnBps: 0, minimumWinProfitBps: 0 });
    expect(result).toMatchObject({ costProbabilityBps: 6667, holdExpectedValue: 0n, passes: false, reason: "insufficient_hold_expected_return" });
  });
  it("trade_size_fee_and_price_impact_change_effective_entry_probability", () => {
    const cheap = executableEntryEconomics({ quote: pricedQuote("yes", "100", "250"), price: price(5000), entryEdgeBps: 0, minimumHoldReturnBps: 0, minimumWinProfitBps: 0 });
    const expensive = executableEntryEconomics({ quote: pricedQuote("yes", "110", "250"), price: price(5000), entryEdgeBps: 0, minimumHoldReturnBps: 0, minimumWinProfitBps: 0 });
    expect(expensive.costProbabilityBps).toBeGreaterThan(cheap.costProbabilityBps);
    expect(expensive.holdReturnBps).toBeLessThan(cheap.holdReturnBps);
  });
  it("late_strategy_selects_side_with_best_conservative_hold_return", () => {
    expect(selectExecutablePolymarketEntry({ quotes: [pricedQuote("yes", "100", "200"), pricedQuote("no", "100", "250")], prices: { yes: price(6000), no: price(5000) }, entryEdgeBps: 0, minimumHoldReturnBps: 0, minimumWinProfitBps: 0 }))
      .toMatchObject({ side: "no", passes: true, holdReturnBps: 2500 });
  });
  it("exact_empty_market_bootstrap_selects_the_stronger_polymarket_side_at_threshold", () => {
    expect(selectEmptyMarketBootstrapEntry({
      quotes: [pricedQuote("yes", "100", "100"), pricedQuote("no", "100", "100")],
      prices: { yes: price(5500), no: price(4500) }, entryEdgeBps: 500,
    })).toMatchObject({ side: "yes", referenceEdgeBps: 500, passes: true, reason: "polymarket_empty_market_bootstrap" });
  });
  it("exact_empty_market_bootstrap_can_select_down", () => {
    expect(selectEmptyMarketBootstrapEntry({
      quotes: [pricedQuote("yes", "100", "100"), pricedQuote("no", "100", "100")],
      prices: { yes: price(4200), no: price(5800) }, entryEdgeBps: 500,
    })).toMatchObject({ side: "no", passes: true });
  });
  it("exact_empty_market_bootstrap_rejects_ties_and_weak_reference_edges", () => {
    const quotes = [pricedQuote("yes", "100", "100"), pricedQuote("no", "100", "100")] as const;
    expect(selectEmptyMarketBootstrapEntry({ quotes, prices: { yes: price(5000), no: price(5000) }, entryEdgeBps: 1 })).toMatchObject({ passes: false, reason: "bootstrap_reference_tie" });
    expect(selectEmptyMarketBootstrapEntry({ quotes, prices: { yes: price(5300), no: price(4700) }, entryEdgeBps: 500 })).toMatchObject({ passes: false, reason: "bootstrap_reference_below_threshold" });
  });
});
