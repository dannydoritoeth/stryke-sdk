import { terminalActionFor, type ExecutableQuote, type PilotPosition, type PositionTerminalAction } from "@stryke/sdk";

import { assertFairProbability } from "./strategy.js";

export type PositionDecision = {
  action: "sell" | "hold" | "claim" | "refund" | "decision_unavailable";
  reason: string;
  sellNowValue?: bigint;
  holdValue?: bigint;
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
