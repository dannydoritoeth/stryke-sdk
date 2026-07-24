import { terminalActionFor, type ExecutableQuote, type PilotPosition, type PositionTerminalAction } from "@stryke/sdk";

import { assertFairProbability } from "./strategy.js";

export type PositionDecision = {
  action: "sell" | "hold" | "claim" | "refund" | "decision_unavailable";
  reason: string;
  sellNowValue?: bigint;
  holdValue?: bigint;
  pnlBps?: bigint;
};

export const decidePositionExit = ({
  side,
  fairProbability,
  sellQuote,
  shares,
  costBasisCollateralUnits,
  ifWinPayout,
  stopLossBps,
  takeProfitBps,
  pendingAction = false,
}: {
  side: "yes" | "no";
  fairProbability: number;
  sellQuote?: ExecutableQuote;
  shares?: string;
  costBasisCollateralUnits?: string;
  ifWinPayout?: string;
  stopLossBps: number;
  takeProfitBps: number;
  pendingAction?: boolean;
}): PositionDecision => {
  if (
    pendingAction ||
    !Number.isSafeInteger(stopLossBps) || stopLossBps <= 0 || stopLossBps > 10_000 ||
    !Number.isSafeInteger(takeProfitBps) || takeProfitBps <= 0 ||
    !shares || !/^\d+$/.test(shares) || BigInt(shares) <= 0n ||
    !costBasisCollateralUnits || !/^\d+$/.test(costBasisCollateralUnits) || BigInt(costBasisCollateralUnits) <= 0n ||
    sellQuote?.action !== "sell" || sellQuote.side !== side || sellQuote.amount !== shares ||
    !sellQuote.expectedNetProceeds || !/^\d+$/.test(sellQuote.expectedNetProceeds) ||
    Date.now() >= Date.parse(sellQuote.expiresAt)
  ) {
    return { action: "decision_unavailable", reason: "exit_inputs_unavailable" };
  }
  const costBasis = BigInt(costBasisCollateralUnits);
  const proceeds = BigInt(sellQuote.expectedNetProceeds);
  const pnlBps = ((proceeds - costBasis) * 10_000n) / costBasis;
  if (pnlBps <= -BigInt(stopLossBps)) {
    return { action: "sell", reason: "stop_loss", sellNowValue: proceeds, pnlBps };
  }
  if (pnlBps >= BigInt(takeProfitBps)) {
    return { action: "sell", reason: "take_profit", sellNowValue: proceeds, pnlBps };
  }
  return {
    ...decideOpenPosition({
      side,
      fairProbability,
      sellQuote,
      ...(ifWinPayout === undefined ? {} : { ifWinPayout }),
    }),
    pnlBps,
  };
};

export const decideOpenPosition = ({
  side,
  fairProbability,
  sellQuote,
  ifWinPayout,
}: {
  side: "yes" | "no";
  fairProbability: number;
  sellQuote?: ExecutableQuote;
  ifWinPayout?: string;
}): PositionDecision => {
  assertFairProbability(fairProbability);
  if (!sellQuote?.expectedNetProceeds || ifWinPayout === undefined || !/^\d+$/.test(ifWinPayout)) {
    return { action: "decision_unavailable", reason: "sell_quote_or_if_win_payout_unavailable" };
  }
  const sideProbability = side === "yes" ? fairProbability : 1 - fairProbability;
  const sellNowValue = BigInt(sellQuote.expectedNetProceeds);
  const probabilityScale = 1_000_000_000n;
  const scaledProbability = BigInt(Math.round(sideProbability * Number(probabilityScale)));
  const holdValue = (BigInt(ifWinPayout) * scaledProbability) / probabilityScale;
  return sellNowValue > holdValue
    ? { action: "sell", reason: "sell_now_exceeds_probability_weighted_hold", sellNowValue, holdValue }
    : { action: "hold", reason: "hold_value_is_greater_or_equal", sellNowValue, holdValue };
};

export const manageTerminalPosition = async (
  position: PilotPosition,
  prepareTerminalAction: (action: PositionTerminalAction, position: PilotPosition) => Promise<unknown>,
  now = Date.now()
): Promise<PositionDecision> => {
  let action: PositionTerminalAction;
  try {
    action = terminalActionFor(position, now);
  } catch {
    return { action: "decision_unavailable", reason: "authoritative_position_not_actionable" };
  }
  await prepareTerminalAction(action, position);
  return { action, reason: `authoritative_position_${action}able` };
};
