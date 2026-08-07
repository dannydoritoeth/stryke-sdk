import type { ExecutableQuote, QuoteSide } from "@stryke/sdk";
import type { PolymarketExecutablePrice } from "./polymarket-client.js";

export type RelativeValueDecision = {
  action: "buy" | "skip";
  reason: string;
  side: QuoteSide;
  edgeBps: number;
  quote: ExecutableQuote;
};

export const decidePolymarketRelativeEntry = ({
  quotes,
  prices,
  entryEdgeBps,
}: {
  quotes: readonly [ExecutableQuote, ExecutableQuote];
  prices: Readonly<Record<QuoteSide, PolymarketExecutablePrice>>;
  entryEdgeBps: number;
}): RelativeValueDecision => {
  const ranked = quotes.map((quote) => ({
    quote,
    side: quote.side,
    edgeBps: prices[quote.side].askBps - quote.normalizedSideProbabilityBps,
  })).sort((a, b) => b.edgeBps - a.edgeBps || a.side.localeCompare(b.side));
  const best = ranked[0]!;
  return best.edgeBps >= entryEdgeBps
    ? { action: "buy", reason: "polymarket_relative_edge", ...best }
    : { action: "skip", reason: "insufficient_polymarket_edge", ...best };
};

export const convergenceReached = ({
  side,
  strykeSellProbabilityBps,
  prices,
  exitEdgeBps,
}: {
  side: QuoteSide;
  strykeSellProbabilityBps: number;
  prices: Readonly<Record<QuoteSide, PolymarketExecutablePrice>>;
  exitEdgeBps: number;
}): { reached: boolean; remainingEdgeBps: number } => {
  const remainingEdgeBps = prices[side].bidBps - strykeSellProbabilityBps;
  return { reached: remainingEdgeBps <= exitEdgeBps, remainingEdgeBps };
};
