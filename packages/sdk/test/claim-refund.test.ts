import { describe, expect, it } from "vitest";

import {
  SUPPORTED_PROGRAM_ID,
  TransactionsClient,
  createTerminalIntentHash,
  parsePilotPosition,
  terminalActionFor,
  type PilotPosition,
  type PositionTerminalAction,
} from "../src/index.js";
import { deadline, positionRow as row } from "./position-fixtures.js";

const beforeDeadline = Date.parse(deadline) - 1;
const clientActionId = "pilot_terminal_action_01";

const prepareTerminal = async (
  position: PilotPosition,
  action: PositionTerminalAction
) => {
  const intentHash = await createTerminalIntentHash({
    clientActionId,
    owner: position.owner,
    market: position.market as Record<string, unknown>,
    action,
  });
  const response = {
    clientActionId,
    intentHash,
    owner: position.owner,
    market: {
      ...position.market,
      marketSeries: position.marketSeries,
      strikeMarket: position.strikeMarket,
    },
    action,
    instructions: [],
    transaction: {
      kind: "instruction_plan",
      feePayer: position.owner,
      recentBlockhashRequired: true,
      signers: [position.owner],
      programId: SUPPORTED_PROGRAM_ID,
      contractProfile: "minimal_pyth",
      cluster: "devnet",
    },
    metadata: { environment: { solanaCluster: "devnet" } },
  };
  const client = {
    capabilities: { contract: { programId: SUPPORTED_PROGRAM_ID } },
    requestJson: async () => response,
  };
  const rpc = {
    getLatestBlockhash: () => ({
      send: async () => ({
        value: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 123n,
        },
      }),
    }),
  };
  return new TransactionsClient(client as never, rpc, () => beforeDeadline)
    .prepareTerminal({
      owner: position.owner,
      position,
      action,
      clientActionId,
      intentHash,
    });
};

describe("claim and refund authority", () => {
  it("resolved_winner_prepares_exact_claim", async () => {
    const position = parsePilotPosition(row("claimable", { claimableAmount: "25" }));
    expect(terminalActionFor(position, beforeDeadline)).toBe("claim");
    await expect(prepareTerminal(position, "claim")).resolves.toMatchObject({
      review: { action: "claim", owner: position.owner },
    });
  });

  it("loser_and_unresolved_position_prepare_no_claim", () => {
    for (const state of ["lost", "awaiting_resolution"] as const) {
      expect(() => terminalActionFor(parsePilotPosition(row(state)), beforeDeadline))
        .toThrowError(expect.objectContaining({ code: "position_state" }));
    }
  });

  it("underfunded_position_prepares_refund_not_claim", async () => {
    const position = parsePilotPosition(
      row("refundable", {
        refundableAmount: "20",
        pilotLifecycle: {
          ...row("refundable").pilotLifecycle,
          rawReason: "market_underfunded_refund",
        },
      })
    );
    expect(terminalActionFor(position, beforeDeadline)).toBe("refund");
    await expect(prepareTerminal(position, "refund")).resolves.toMatchObject({
      review: { action: "refund", owner: position.owner },
    });
  });

  it("zero_winner_position_prepares_refund_not_claim", () => {
    const position = parsePilotPosition(
      row("refundable", {
        refundableAmount: "20",
        pilotLifecycle: {
          ...row("refundable").pilotLifecycle,
          rawReason: "settlement_zero_winner",
        },
      })
    );
    expect(terminalActionFor(position, beforeDeadline)).toBe("refund");
  });

  it("sdk_never_invents_failed_resolution_refund", () => {
    const position = parsePilotPosition(
      row("refundable", {
        refundableAmount: "20",
        pilotLifecycle: {
          ...row("refundable").pilotLifecycle,
          rawReason: "resolution_failed",
        },
      })
    );
    expect(() => terminalActionFor(position, beforeDeadline)).toThrowError(
      expect.objectContaining({ code: "position_state" })
    );
  });

  it("claimed_refunded_or_expired_position_is_not_actionable", () => {
    for (const state of ["claimed", "refunded", "expired_unclaimed"] as const) {
      expect(() => terminalActionFor(parsePilotPosition(row(state)), beforeDeadline))
        .toThrowError(expect.objectContaining({ code: "position_state" }));
    }
  });
});
