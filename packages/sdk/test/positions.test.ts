import { describe, expect, it } from "vitest";

import {
  PositionsClient,
  parsePilotPosition,
  terminalActionFor,
  type PilotMarket,
  type PilotPositionLifecycleState,
} from "../src/index.js";

const deadline = "2026-07-23T00:00:00.000Z";
const row = (
  state: PilotPositionLifecycleState,
  overrides: Record<string, unknown> = {}
) => ({
  owner: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
  tokenMint: "So11111111111111111111111111111111111111112",
  source: "pyth_oracle",
  collateral: { type: "native_sol", mint: "11111111111111111111111111111111", symbol: "SOL", decimals: 9 },
  expiryFamily: "five_minute",
  expiryTs: 1_800_000_000,
  targetValue: "7000000000000",
  status: "active",
  marketSeries: "series-1",
  strikeMarket: "strike-1",
  yesShares: "10",
  noShares: "0",
  forceClose: { expiryAt: deadline },
  pilotLifecycle: {
    schemaVersion: "stryke.pilotLifecycle.v1",
    state,
    rawStatus: state,
    rawReason: `position_${state}`,
    observedAt: "2026-07-22T00:00:00.000Z",
    observedSlot: 456,
  },
  ...overrides,
});

const market = {
  assetRef: "So11111111111111111111111111111111111111112",
  source: "pyth_oracle",
  expiryFamily: "five_minute",
  expiryTs: 1_800_000_000,
  strikePrice: "7000000000000",
  raw: { collateral: { mint: "11111111111111111111111111111111" } },
} as PilotMarket;

describe("pilot positions", () => {
  it("normalizes_pending_open_sellable_awaiting_resolution_and_terminal_states", () => {
    const states: PilotPositionLifecycleState[] = [
      "pending_confirmation",
      "open_position",
      "sellable",
      "awaiting_resolution",
      "claimable",
      "refundable",
      "lost",
      "claimed",
      "refunded",
      "sold",
      "expired_unclaimed",
    ];
    for (const state of states) {
      expect(parsePilotPosition(row(state))).toMatchObject({
        lifecycle: {
          state,
          rawStatus: state,
          rawReason: `position_${state}`,
          observedSlot: 456,
        },
      });
    }
  });

  it("position_identity_mismatch_or_ambiguity_fails_closed", async () => {
    const client = (positions: unknown[]) => ({
      requestJson: async () => ({
        owner: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
        positions,
        metadata: { stale: false, generatedAt: "2026-07-22T00:00:00.000Z" },
      }),
    });
    await expect(
      new PositionsClient(client([row("sellable", { tokenMint: "other" })]) as never)
        .forMarket("HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7", market)
    ).rejects.toMatchObject({ code: "position_state" });
    await expect(
      new PositionsClient(client([row("sellable"), row("sellable")]) as never)
        .forMarket("HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7", market)
    ).rejects.toMatchObject({ code: "position_state" });
  });

  it("lost_position_is_not_claimable", () => {
    expect(() => terminalActionFor(parsePilotPosition(row("lost")))).toThrowError(
      expect.objectContaining({ code: "position_state" })
    );
  });

  it("claim_refund_deadline_is_preserved_and_enforced", () => {
    const position = parsePilotPosition(
      row("claimable", { claimableAmount: "10" })
    );
    expect(position.actionDeadline).toBe(deadline);
    expect(terminalActionFor(position, Date.parse("2026-07-22T00:00:00Z"))).toBe("claim");
    expect(() => terminalActionFor(position, Date.parse(deadline))).toThrowError(
      expect.objectContaining({ code: "position_state" })
    );
  });
});
