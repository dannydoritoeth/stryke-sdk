import type { ExecutableQuote, QuoteSide } from "@stryketrade/sdk";
import type { PolymarketExecutablePrice } from "../polymarket-client.js";

export type ExecutableEntryEconomics = {
  side: QuoteSide; quote: ExecutableQuote; totalCost: bigint; projectedPayout: bigint;
  costProbabilityBps: number; referenceProbabilityBps: number; relativeEdgeBps: number;
  profitIfWins: bigint; winProfitBps: number; holdExpectedValue: bigint; holdReturnBps: number;
  passes: boolean; reason: string;
};

export type EmptyMarketBootstrapDecision = {
  quote: ExecutableQuote;
  side: QuoteSide;
  referenceProbabilityBps: number;
  referenceEdgeBps: number;
  passes: boolean;
  reason: "polymarket_empty_market_bootstrap" | "bootstrap_reference_tie" | "bootstrap_reference_below_threshold";
};

const safeNumber = (value: bigint, field: string): number => {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${field} exceeds safe diagnostic range`);
  return Number(value);
};

export const executableEntryEconomics = ({ quote, price, entryEdgeBps, minimumHoldReturnBps, minimumWinProfitBps }: {
  quote: ExecutableQuote; price: PolymarketExecutablePrice; entryEdgeBps: number;
  minimumHoldReturnBps: number; minimumWinProfitBps: number;
}): ExecutableEntryEconomics => {
  const totalCost = BigInt(quote.grossAmount);
  const projectedPayout = BigInt(quote.resultingPositionValuation?.winningPayoutCollateralUnits ?? quote.economics.projectedWinningPayout);
  if (totalCost <= 0n || projectedPayout <= 0n) throw new RangeError("Executable cost and projected payout must be positive");
  const costProbabilityBps = safeNumber((totalCost * 10_000n + projectedPayout - 1n) / projectedPayout, "cost probability");
  const referenceProbabilityBps = price.askBps;
  const relativeEdgeBps = referenceProbabilityBps - costProbabilityBps;
  const profitIfWins = projectedPayout - totalCost;
  const winProfitBps = safeNumber((profitIfWins * 10_000n) / totalCost, "win profit");
  const holdExpectedValue = (BigInt(referenceProbabilityBps) * projectedPayout) / 10_000n - totalCost;
  const holdReturnBps = safeNumber((holdExpectedValue * 10_000n) / totalCost, "hold return");
  const reason = relativeEdgeBps < entryEdgeBps ? "insufficient_polymarket_edge"
    : profitIfWins <= 0n ? "non_positive_win_profit"
      : winProfitBps < minimumWinProfitBps ? "insufficient_win_profit"
        : holdExpectedValue <= 0n || holdReturnBps < minimumHoldReturnBps ? "insufficient_hold_expected_return"
          : "polymarket_executable_edge";
  return { side: quote.side, quote, totalCost, projectedPayout, costProbabilityBps, referenceProbabilityBps, relativeEdgeBps, profitIfWins, winProfitBps, holdExpectedValue, holdReturnBps, passes: reason === "polymarket_executable_edge", reason };
};

export const selectExecutablePolymarketEntry = ({ quotes, prices, entryEdgeBps, minimumHoldReturnBps, minimumWinProfitBps }: {
  quotes: readonly [ExecutableQuote, ExecutableQuote]; prices: Readonly<Record<QuoteSide, PolymarketExecutablePrice>>;
  entryEdgeBps: number; minimumHoldReturnBps: number; minimumWinProfitBps: number;
}): ExecutableEntryEconomics => {
  const ranked = quotes.map((quote) => executableEntryEconomics({ quote, price: prices[quote.side], entryEdgeBps, minimumHoldReturnBps, minimumWinProfitBps }))
    .sort((a, b) => b.holdReturnBps - a.holdReturnBps || b.relativeEdgeBps - a.relativeEdgeBps || a.side.localeCompare(b.side));
  const [best, second] = ranked as [ExecutableEntryEconomics, ExecutableEntryEconomics];
  if (best.passes && second.passes && best.holdReturnBps === second.holdReturnBps && best.relativeEdgeBps === second.relativeEdgeBps) return { ...best, passes: false, reason: "economic_tie" };
  return best;
};

export const selectEmptyMarketBootstrapEntry = ({ quotes, prices, entryEdgeBps }: {
  quotes: readonly [ExecutableQuote, ExecutableQuote];
  prices: Readonly<Record<QuoteSide, PolymarketExecutablePrice>>;
  entryEdgeBps: number;
}): EmptyMarketBootstrapDecision => {
  const ranked = quotes
    .map((quote) => ({ quote, side: quote.side, referenceProbabilityBps: prices[quote.side].askBps }))
    .sort((a, b) => b.referenceProbabilityBps - a.referenceProbabilityBps || a.side.localeCompare(b.side));
  const [best, second] = ranked as [typeof ranked[number], typeof ranked[number]];
  const referenceEdgeBps = best.referenceProbabilityBps - 5_000;
  if (best.referenceProbabilityBps === second.referenceProbabilityBps) {
    return { ...best, referenceEdgeBps, passes: false, reason: "bootstrap_reference_tie" };
  }
  if (referenceEdgeBps < entryEdgeBps) {
    return { ...best, referenceEdgeBps, passes: false, reason: "bootstrap_reference_below_threshold" };
  }
  return { ...best, referenceEdgeBps, passes: true, reason: "polymarket_empty_market_bootstrap" };
};
