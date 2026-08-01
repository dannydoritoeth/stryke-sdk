import { SUPPORTED_PROGRAM_ID, SUPPORTED_QUOTE_MATH_VERSION, type ExecutableQuote, type PilotPosition } from "@stryke/sdk";

export const quote = (overrides: Partial<ExecutableQuote> = {}): ExecutableQuote => {
  const value: ExecutableQuote = ({
  quoteId: "quote-1",
  generatedAt: "2026-07-22T00:00:00.000Z",
  expiresAt: "2026-07-22T00:01:00.000Z",
  marketStateVersion: "state-1",
  action: "buy",
  side: "yes",
  amount: "10000000",
  programId: SUPPORTED_PROGRAM_ID,
  mathVersion: SUPPORTED_QUOTE_MATH_VERSION,
  fee: "0",
  grossAmount: "10000000",
  feeAmount: "0",
  netAmount: "10000000",
  sharesIn: "0",
  sharesOut: "20000000",
  averageExecutionPriceBps: "5000",
  postTradeSideReserve: "10000000",
  postTradeSideShares: "20000000",
  feeBreakdown: {
    feeMode: "waived",
    normalTradingFeeWaivedCollateralUnits: "0",
    grossTradeFeeCollateralUnits: "0",
    normalTradingFeeBps: 0,
    feeBpsApplied: 0,
  },
  closingProtection: {
    policyVersion: 1,
    phase: "open",
    baseFeeBps: 0,
    closingFeeBps: 0,
    effectiveFeeBps: 0,
    closingStartsAt: 1_799_999_970,
    hardLockTs: 1_800_000_000,
    secondsUntilLock: 60,
  },
  expectedShares: "20000000",
  minimumOutput: "19800000",
  maximumSlippageBpsApplied: 100,
  executableProbabilityBps: 5000,
  normalizedSideProbabilityBps: 5000,
  priceImpactBps: 50,
  economics: {
    economicVersion: 2,
    grossAmount: "10000000",
    tradeFee: "0",
    netPrincipalDelta: "10000000",
    participationUnitsDelta: "20000000",
    remainingPrincipal: "10000000",
    desiredCurveValue: "10000000",
    backedPremium: "0",
    surplusDelta: "0",
    executableCurrentValue: "10000000",
    projectedWinningPayout: "10000000",
    currentPnl: "0",
    profitIfWins: "0",
  },
  raw: {},
  ...overrides,
  });
  if (overrides.executableProbabilityBps !== undefined && overrides.normalizedSideProbabilityBps === undefined) {
    value.normalizedSideProbabilityBps = overrides.executableProbabilityBps;
  }
  return value;
};

export const position = (overrides: Partial<PilotPosition> = {}): PilotPosition => ({
  positionId: "position-1",
  owner: "owner",
  market: {},
  yesShares: "10",
  noShares: "0",
  claimableAmount: "10",
  actionDeadline: "2026-07-23T00:00:00.000Z",
  lifecycle: {
    state: "claimable",
    rawState: "resolved_yes",
    rawReason: "winner_claimable",
    observedAt: "2026-07-22T00:00:00.000Z",
    source: "api_v1",
  },
  raw: {},
  ...overrides,
});
