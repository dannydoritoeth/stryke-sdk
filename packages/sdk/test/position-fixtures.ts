import type { PilotPositionLifecycleState } from "../src/index.js";

export const deadline = "2026-07-23T00:00:00.000Z";

export const positionRow = (
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
  yesCostBasisCollateralUnits: "7",
  noCostBasisCollateralUnits: "0",
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
