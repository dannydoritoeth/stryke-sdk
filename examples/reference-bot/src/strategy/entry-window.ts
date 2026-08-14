import type { ExecutableQuote, PilotMarket } from "@stryketrade/sdk";

export type PolymarketTimingMode = "polymarket_early" | "polymarket_late";
export type EntryWindowDecision = { eligible: boolean; reason: string; opensAt: number; closesAt: number };

export const polymarketEntryWindow = ({ mode, market, quote, now, earlyWindowSeconds, lateWindowSeconds, submissionBufferSeconds, lateEntryCloseLeadSeconds }: {
  mode: PolymarketTimingMode; market: PilotMarket; quote: ExecutableQuote; now: number;
  earlyWindowSeconds: number; lateWindowSeconds: number; submissionBufferSeconds: number; lateEntryCloseLeadSeconds?: number;
}): EntryWindowDecision => {
  const opensAt = mode === "polymarket_early"
    ? market.intervalStartTs
    : quote.closingProtection.closingStartsAt - lateWindowSeconds;
  const closesAt = mode === "polymarket_early"
    ? Math.min(market.intervalStartTs + earlyWindowSeconds, quote.closingProtection.closingStartsAt)
    : quote.closingProtection.closingStartsAt - (lateEntryCloseLeadSeconds ?? submissionBufferSeconds);
  if (now < opensAt) return { eligible: false, reason: "entry_window_not_open", opensAt, closesAt };
  if (now >= closesAt) return { eligible: false, reason: "entry_window_closed", opensAt, closesAt };
  if (quote.closingProtection.phase !== "open") return { eligible: false, reason: "closing_fee_started", opensAt, closesAt };
  return { eligible: true, reason: "entry_window_open", opensAt, closesAt };
};
