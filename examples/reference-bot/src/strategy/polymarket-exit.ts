import type { ExecutableQuote } from "@stryketrade/sdk";

import { decidePositionExit, type PositionDecision } from "../manage-position.js";
import type { PolymarketExecutablePrice } from "../polymarket-client.js";
import { convergenceReached } from "../polymarket-relative-value.js";

export type PolymarketEarlyExitPolicy = "hold_to_expiry" | "exit_on_convergence" | "risk_managed";

export const decidePolymarketEarlyExit = ({
  policy,
  side,
  sellQuote,
  shares,
  costBasisCollateralUnits,
  ifWinPayout,
  stopLossBps,
  takeProfitBps,
  prices,
  exitEdgeBps,
}: {
  policy: PolymarketEarlyExitPolicy;
  side: "yes" | "no";
  sellQuote: ExecutableQuote;
  shares: string;
  costBasisCollateralUnits?: string;
  ifWinPayout: string;
  stopLossBps: number;
  takeProfitBps: number;
  prices?: Readonly<Record<"yes" | "no", PolymarketExecutablePrice>>;
  exitEdgeBps: number;
}): { decision: PositionDecision; diagnostics: Record<string, string | number | boolean> } => {
  if (policy === "hold_to_expiry") {
    return { decision: { action: "hold", reason: "strategy_holds_to_expiry" }, diagnostics: {} };
  }

  if (policy === "risk_managed") {
    const risk = decidePositionExit({
      side,
      fairProbability: 0,
      sellQuote,
      shares,
      ...(costBasisCollateralUnits === undefined ? {} : { costBasisCollateralUnits }),
      ifWinPayout,
      stopLossBps,
      takeProfitBps,
    });
    if (risk.action === "sell" && ["stop_loss", "take_profit"].includes(risk.reason)) {
      return { decision: risk, diagnostics: {} };
    }
  }

  if (!prices) {
    return {
      decision: { action: "hold", reason: "position_not_economically_complete" },
      diagnostics: { convergenceReferenceAvailable: false },
    };
  }
  const convergence = convergenceReached({
    side,
    strykeSellProbabilityBps: sellQuote.normalizedSideProbabilityBps,
    prices,
    exitEdgeBps,
  });
  return {
    decision: convergence.reached
      ? { action: "sell", reason: "polymarket_convergence" }
      : { action: "hold", reason: "position_not_economically_complete" },
    diagnostics: { remainingEdgeBps: convergence.remainingEdgeBps },
  };
};
