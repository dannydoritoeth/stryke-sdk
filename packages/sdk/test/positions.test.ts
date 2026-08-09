import { describe, expect, it } from "vitest";

import {
  PositionsClient,
  parsePilotPosition,
  positionCleanupAvailable,
  positionCleanupPending,
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
  tokenSymbol: "BTC",
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
  yesCostBasisCollateralUnits: "7",
  noCostBasisCollateralUnits: "0",
  economicVersion: 2,
  valuation: {
    costBasisCollateralUnits: "7",
    currentValueCollateralUnits: "8",
    currentPnlCollateralUnits: "1",
    currentPnlBps: 1428,
    winningPayoutCollateralUnits: "22",
    profitIfWinsCollateralUnits: "15",
    profitIfWinsBps: 21428,
    marketStateVersion: "70:30:20:10:7",
    generatedAt: "2026-07-22T00:00:00.000Z",
    stale: false,
  },
  poolState: { realYesPoolCollateralUnits: "70", realNoPoolCollateralUnits: "30", totalYesShares: "20", totalNoShares: "10" },
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
  it("accepts only same-owner zero-share cleanup availability", () => {
    const cleanup = {
      rentRecipient: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
      selfCloseAvailable: true,
      staleCleanup: {
        status: "eligible",
        action: "close_position",
        cleanupEligibleAt: "2026-07-22T00:00:00.000Z",
      },
    };
    const parsed = parsePilotPosition(row("expired_unclaimed", {
      yesShares: "0",
      noShares: "0",
      forceClose: { expiryAt: deadline, status: "settled" },
      cleanup,
    }));
    expect(positionCleanupAvailable(parsed)).toBe(true);
    expect(positionCleanupPending(parsed)).toBe(true);
    expect(positionCleanupAvailable({
      ...parsed,
      cleanup: { ...parsed.cleanup!, rentRecipient: "11111111111111111111111111111111" },
    })).toBe(false);
  });

  it("does not expose cleanup before the authoritative eligibility time", () => {
    const parsed = parsePilotPosition(row("expired_unclaimed", {
      yesShares: "0",
      noShares: "0",
      forceClose: { expiryAt: deadline, status: "settled" },
      cleanup: {
        rentRecipient: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
        selfCloseAvailable: true,
        staleCleanup: {
          status: "eligible",
          action: "close_position",
          cleanupEligibleAt: "2026-07-22T00:01:00.000Z",
        },
      },
    }));
    expect(positionCleanupPending(parsed)).toBe(true);
    expect(positionCleanupAvailable(parsed, Date.parse("2026-07-22T00:00:59.999Z"))).toBe(false);
    expect(positionCleanupAvailable(parsed, Date.parse("2026-07-22T00:01:00.000Z"))).toBe(true);
  });

  it("waits for API cleanup eligibility even after the eligibility timestamp", () => {
    const parsed = parsePilotPosition(row("expired_unclaimed", {
      yesShares: "0",
      noShares: "0",
      forceClose: {
        expiryAt: deadline,
        status: "not_settled",
        blockedReason: "market_not_settled",
      },
      cleanup: {
        rentRecipient: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
        selfCloseAvailable: true,
        staleCleanup: {
          status: "awaiting_resolution",
          action: "close_position",
          cleanupEligibleAt: "2026-07-22T00:00:00.000Z",
        },
      },
    }));
    expect(positionCleanupPending(parsed)).toBe(true);
    expect(positionCleanupAvailable(parsed, Date.parse("2026-07-23T00:00:00.000Z"))).toBe(false);
    expect(parsed.cleanup).toMatchObject({
      eligibilityStatus: "awaiting_resolution",
      marketSettlementStatus: "not_settled",
      blockedReason: "market_not_settled",
    });
  });

  it("accepts API-eligible cleanup when the on-chain stale-close path does not require settlement", () => {
    const parsed = parsePilotPosition(row("expired_unclaimed", {
      yesShares: "0",
      noShares: "0",
      forceClose: {
        expiryAt: deadline,
        status: "not_settled",
        blockedReason: "market_not_settled",
      },
      cleanup: {
        rentRecipient: "HYDrCb45WNbMzLjKqQByKduksFCasUfgLNpkA7xvcxf7",
        selfCloseAvailable: true,
        staleCleanup: {
          status: "eligible",
          action: "close_position",
          cleanupEligibleAt: "2026-07-22T00:00:00.000Z",
        },
      },
    }));
    expect(positionCleanupAvailable(parsed, Date.parse("2026-07-23T00:00:00.000Z"))).toBe(true);
    expect(parsed.cleanup).toMatchObject({
      eligibilityStatus: "eligible",
      marketSettlementStatus: "not_settled",
    });
  });

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

  it("preserves_side_cost_basis_as_exact_integer_units", () => {
    expect(parsePilotPosition(row("sellable"))).toMatchObject({
      yesShares: "10",
      asset: "BTC",
      yesCostBasisCollateralUnits: "7",
      noCostBasisCollateralUnits: "0",
      economicVersion: 2,
      valuation: {
        currentValueCollateralUnits: "8",
        winningPayoutCollateralUnits: "22",
      },
    });
  });

  it("sdk_positions_use_authoritative_v2_valuations", () => {
    const position = parsePilotPosition(row("sellable"));
    expect(position.valuation).toMatchObject({
      costBasisCollateralUnits: "7",
      currentValueCollateralUnits: "8",
      winningPayoutCollateralUnits: "22",
      profitIfWinsCollateralUnits: "15",
      stale: false,
    });
  });

  it.each([
    ["V1", { economicVersion: 1 }],
    ["missing", { economicVersion: undefined, valuation: undefined }],
    ["stale", { valuation: { ...row("sellable").valuation as object, stale: true } }],
    ["malformed", { valuation: { ...row("sellable").valuation as object, currentPnlBps: "NaN" } }],
  ])("sdk_and_bot_fail_closed_on_unverifiable_economics: %s", (_name, overrides) => {
    expect(() => parsePilotPosition(row("sellable", overrides))).toThrowError(
      expect.objectContaining({ code: expect.stringMatching(/compatibility|source_stale|api_response/) })
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
