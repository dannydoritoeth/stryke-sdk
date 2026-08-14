import type { ExecutableQuote, QuoteSide } from "@stryketrade/sdk";
import type { PolymarketExecutablePrice } from "../polymarket-client.js";
import { selectExecutablePolymarketEntry } from "./polymarket-entry.js";

export const preFeeRevalidationWindow = ({ quote, now, windowSeconds, submissionBufferSeconds }: {
  quote: ExecutableQuote; now: number; windowSeconds: number; submissionBufferSeconds: number;
}) => {
  const opensAt = quote.closingProtection.closingStartsAt - windowSeconds;
  const closesAt = quote.closingProtection.closingStartsAt - submissionBufferSeconds;
  if (now < opensAt) return { eligible: false, reason: "pre_fee_revalidation_not_open", opensAt, closesAt } as const;
  if (now >= closesAt || quote.closingProtection.phase !== "open") return { eligible: false, reason: "pre_fee_revalidation_window_closed", opensAt, closesAt } as const;
  return { eligible: true, reason: "pre_fee_revalidation_window_open", opensAt, closesAt } as const;
};

export const decidePreFeeRevalidation = ({ heldSide, quotes, prices, entryEdgeBps, minimumHoldReturnBps, minimumWinProfitBps }: {
  heldSide: QuoteSide; quotes: readonly [ExecutableQuote, ExecutableQuote];
  prices: Readonly<Record<QuoteSide, PolymarketExecutablePrice>>; entryEdgeBps: number;
  minimumHoldReturnBps: number; minimumWinProfitBps: number;
}) => {
  const selected = selectExecutablePolymarketEntry({ quotes, prices, entryEdgeBps, minimumHoldReturnBps, minimumWinProfitBps });
  const hold = selected.passes && selected.side === heldSide;
  return { action: hold ? "hold" : "sell", reason: hold ? "polymarket_pre_fee_signal_confirmed" : "polymarket_pre_fee_signal_changed", selected } as const;
};
