import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import {
  SUPPORTED_PROGRAM_ID,
  SUPPORTED_QUOTE_MATH_VERSION,
} from "./compatibility.js";
import { assertMarketTradeable, type PilotMarket } from "./markets.js";

export type QuoteAction = "buy" | "sell";
export type QuoteSide = "yes" | "no";

export type QuoteFeeBreakdown = {
  feeMode: string;
  normalTradingFeeWaivedCollateralUnits: string;
  grossTradeFeeCollateralUnits: string;
  normalTradingFeeBps: number;
  feeBpsApplied: number;
};

export type ClosingProtection = {
  policyVersion: 1;
  phase: "open" | "closing" | "locked" | "expired";
  baseFeeBps: number;
  closingFeeBps: number;
  effectiveFeeBps: number;
  hardLockTs: number;
  secondsUntilLock: number;
};

export type ExecutableQuote = {
  quoteId: string;
  generatedAt: string;
  expiresAt: string;
  marketStateVersion: string;
  marketStateSlot?: number;
  action: QuoteAction;
  side: QuoteSide;
  amount: string;
  programId: typeof SUPPORTED_PROGRAM_ID;
  mathVersion: typeof SUPPORTED_QUOTE_MATH_VERSION;
  quoteSlot?: string;
  fee: string;
  grossAmount: string;
  feeAmount: string;
  netAmount: string;
  sharesIn?: string;
  sharesOut?: string;
  averageExecutionPriceBps: string;
  postTradeSideReserve: string;
  postTradeSideShares: string;
  feeBreakdown: QuoteFeeBreakdown;
  closingProtection: ClosingProtection;
  expectedShares?: string;
  expectedNetProceeds?: string;
  minimumOutput: string;
  maximumSlippageBpsApplied: number;
  executableProbabilityBps: number;
  /** Normalized market probability for the quoted side; not the sized execution price. */
  normalizedSideProbabilityBps: number;
  priceImpactBps: number;
  economics: PrincipalBackedQuoteEconomics;
  quotedTradeValuation?: PositionValuation;
  resultingPositionValuation?: PositionValuation;
  raw: Readonly<Record<string, unknown>>;
};

export type PositionValuation = {
  costBasisCollateralUnits: string;
  currentValueCollateralUnits?: string;
  currentPnlCollateralUnits?: string;
  currentPnlBps?: number;
  winningPayoutCollateralUnits?: string;
  profitIfWinsCollateralUnits?: string;
  profitIfWinsBps?: number;
  marketStateVersion: string;
  generatedAt: string;
  stale: boolean;
};

export type PrincipalBackedQuoteEconomics = {
  economicVersion: 2;
  grossAmount: string;
  tradeFee: string;
  netPrincipalDelta: string;
  participationUnitsDelta: string;
  remainingPrincipal: string;
  desiredCurveValue: string;
  backedPremium: string;
  surplusDelta: string;
  executableCurrentValue: string;
  projectedWinningPayout: string;
  currentPnl: string;
  profitIfWins: string;
};

const integerString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new StrykeSdkError("validation", `Invalid quote field: ${field}`);
  }
  return value;
};

const signedIntegerString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
    throw new StrykeSdkError("validation", `Invalid quote field: ${field}`);
  }
  return value;
};

const positionValuation = (
  value: unknown,
  field: string
): PositionValuation | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("api_response", `Invalid quote field: ${field}`);
  }
  const row = value as Record<string, unknown>;
  const generatedAt = text(row.generatedAt, `${field}.generatedAt`);
  if (!Number.isFinite(Date.parse(generatedAt)) || row.stale !== false) {
    throw new StrykeSdkError("quote_blocked", `${field} is stale or invalid`);
  }
  return {
    costBasisCollateralUnits: integerString(
      row.costBasisCollateralUnits,
      `${field}.costBasisCollateralUnits`
    ),
    ...(row.currentValueCollateralUnits === undefined
      ? {}
      : {
          currentValueCollateralUnits: integerString(
            row.currentValueCollateralUnits,
            `${field}.currentValueCollateralUnits`
          ),
        }),
    ...(row.currentPnlCollateralUnits === undefined
      ? {}
      : {
          currentPnlCollateralUnits: signedIntegerString(
            row.currentPnlCollateralUnits,
            `${field}.currentPnlCollateralUnits`
          ),
        }),
    ...(row.currentPnlBps === undefined
      ? {}
      : { currentPnlBps: integer(row.currentPnlBps, `${field}.currentPnlBps`) }),
    ...(row.winningPayoutCollateralUnits === undefined
      ? {}
      : {
          winningPayoutCollateralUnits: integerString(
            row.winningPayoutCollateralUnits,
            `${field}.winningPayoutCollateralUnits`
          ),
        }),
    ...(row.profitIfWinsCollateralUnits === undefined
      ? {}
      : {
          profitIfWinsCollateralUnits: signedIntegerString(
            row.profitIfWinsCollateralUnits,
            `${field}.profitIfWinsCollateralUnits`
          ),
        }),
    ...(row.profitIfWinsBps === undefined
      ? {}
      : { profitIfWinsBps: integer(row.profitIfWinsBps, `${field}.profitIfWinsBps`) }),
    marketStateVersion: text(row.marketStateVersion, `${field}.marketStateVersion`),
    generatedAt,
    stale: false,
  };
};

const principalBackedEconomics = (value: unknown): PrincipalBackedQuoteEconomics => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("compatibility", "Principal-backed V2 economics are unavailable");
  }
  const row = value as Record<string, unknown>;
  if (row.economicVersion !== 2) {
    throw new StrykeSdkError("compatibility", "Quote economic version is unsupported");
  }
  return {
    economicVersion: 2,
    grossAmount: integerString(row.grossAmount, "economics.grossAmount"),
    tradeFee: integerString(row.tradeFee, "economics.tradeFee"),
    netPrincipalDelta: signedIntegerString(row.netPrincipalDelta, "economics.netPrincipalDelta"),
    participationUnitsDelta: signedIntegerString(row.participationUnitsDelta, "economics.participationUnitsDelta"),
    remainingPrincipal: integerString(row.remainingPrincipal, "economics.remainingPrincipal"),
    desiredCurveValue: integerString(row.desiredCurveValue, "economics.desiredCurveValue"),
    backedPremium: integerString(row.backedPremium, "economics.backedPremium"),
    surplusDelta: signedIntegerString(row.surplusDelta, "economics.surplusDelta"),
    executableCurrentValue: integerString(row.executableCurrentValue, "economics.executableCurrentValue"),
    projectedWinningPayout: integerString(row.projectedWinningPayout, "economics.projectedWinningPayout"),
    currentPnl: signedIntegerString(row.currentPnl, "economics.currentPnl"),
    profitIfWins: signedIntegerString(row.profitIfWins, "economics.profitIfWins"),
  };
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new StrykeSdkError("validation", `Invalid quote field: ${field}`);
  }
  return value;
};

const integer = (value: unknown, field: string): number => {
  if (!Number.isInteger(value)) {
    throw new StrykeSdkError("validation", `Invalid quote field: ${field}`);
  }
  return value as number;
};

const feeBreakdown = (value: unknown): QuoteFeeBreakdown => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("api_response", "Quote fee breakdown is invalid");
  }
  const row = value as Record<string, unknown>;
  return {
    feeMode: text(row.feeMode, "feeBreakdown.feeMode"),
    normalTradingFeeWaivedCollateralUnits: integerString(
      row.normalTradingFeeWaivedCollateralUnits,
      "feeBreakdown.normalTradingFeeWaivedCollateralUnits"
    ),
    grossTradeFeeCollateralUnits: integerString(
      row.grossTradeFeeCollateralUnits,
      "feeBreakdown.grossTradeFeeCollateralUnits"
    ),
    normalTradingFeeBps: integer(
      row.normalTradingFeeBps,
      "feeBreakdown.normalTradingFeeBps"
    ),
    feeBpsApplied: integer(row.feeBpsApplied, "feeBreakdown.feeBpsApplied"),
  };
};

const closingProtection = (value: unknown): ClosingProtection => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StrykeSdkError("api_response", "Closing protection is unavailable");
  }
  const row = value as Record<string, unknown>;
  const policyVersion = integer(row.policyVersion, "closingProtection.policyVersion");
  const phase = text(row.phase, "closingProtection.phase");
  if (policyVersion !== 1 || !["open", "closing", "locked", "expired"].includes(phase)) {
    throw new StrykeSdkError("compatibility", "Closing protection policy is unsupported");
  }
  const parsed = {
    policyVersion: 1 as const,
    phase: phase as ClosingProtection["phase"],
    baseFeeBps: integer(row.baseFeeBps, "closingProtection.baseFeeBps"),
    closingFeeBps: integer(row.closingFeeBps, "closingProtection.closingFeeBps"),
    effectiveFeeBps: integer(row.effectiveFeeBps, "closingProtection.effectiveFeeBps"),
    hardLockTs: integer(row.hardLockTs, "closingProtection.hardLockTs"),
    secondsUntilLock: integer(row.secondsUntilLock, "closingProtection.secondsUntilLock"),
  };
  if (
    parsed.baseFeeBps < 0 || parsed.closingFeeBps < 0 ||
    parsed.effectiveFeeBps !== Math.max(parsed.baseFeeBps, parsed.closingFeeBps) ||
    parsed.hardLockTs <= 0 || parsed.secondsUntilLock < 0
  ) {
    throw new StrykeSdkError("api_response", "Closing protection fields are inconsistent");
  }
  return parsed;
};

export const assertQuoteUsable = (
  quote: ExecutableQuote,
  {
    marketStateVersion,
    now = Date.now(),
  }: { marketStateVersion: string; now?: number }
): void => {
  if (now >= Date.parse(quote.expiresAt)) {
    throw new StrykeSdkError("quote_blocked", "Executable quote has expired");
  }
  if (quote.marketStateVersion !== marketStateVersion) {
    throw new StrykeSdkError(
      "quote_blocked",
      "Market state changed after the quote was generated",
      false,
      { quoteId: quote.quoteId, marketStateVersion }
    );
  }
};

export class QuotesClient {
  constructor(
    private readonly client: StrykeClient,
    private readonly now: () => number = Date.now
  ) {}

  async get({
    market,
    action,
    side,
    amount,
    maximumSlippageBps,
    owner,
  }: {
    market: PilotMarket;
    action: QuoteAction;
    side: QuoteSide;
    amount: string;
    maximumSlippageBps: number;
    owner?: string;
  }): Promise<ExecutableQuote> {
    assertMarketTradeable(market, "quote");
    integerString(amount, "amount");
    if (action === "sell" && (typeof owner !== "string" || owner.length === 0)) {
      throw new StrykeSdkError(
        "validation",
        "Owner is required for principal-backed sell quotes"
      );
    }
    const collateral = market.raw.collateral;
    if (typeof collateral !== "object" || collateral === null) {
      throw new StrykeSdkError("validation", "Market collateral metadata is unavailable");
    }
    const response = await this.client.requestJson<{
      quote: Record<string, unknown>;
      metadata: { stale: boolean };
    }>("/v1/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        market: {
          tokenMint: market.tokenMint,
          source: market.source,
          collateral,
          expiryFamily: market.expiryFamily,
          expiryTs: market.expiryTs,
          targetValue: market.strikePrice,
        },
        action,
        side,
        amount,
        ...(owner === undefined ? {} : { owner }),
        maxSlippageBps: maximumSlippageBps,
      }),
    });
    const quote = response.quote;
    const protection = closingProtection(quote.closingProtection);
    if (response.metadata.stale || quote.stale === true || quote.unavailableReason) {
      throw new StrykeSdkError(
        quote.unavailableReason === "stale" ? "source_stale" : "quote_blocked",
        typeof quote.unavailableReason === "string"
          ? quote.unavailableReason
          : "Executable quote is stale or unavailable",
        protection.phase !== "locked" && protection.phase !== "expired",
        { phase: protection.phase, policyVersion: protection.policyVersion }
      );
    }
    const expiresAt = text(quote.expiresAt, "expiresAt");
    const generatedAt = text(quote.generatedAt, "generatedAt");
    if (
      !Number.isFinite(Date.parse(generatedAt)) ||
      !Number.isFinite(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.parse(generatedAt)
    ) {
      throw new StrykeSdkError("api_response", "Quote validity timestamps are invalid");
    }
    if (this.now() >= Date.parse(expiresAt)) {
      throw new StrykeSdkError("quote_blocked", "Executable quote has expired");
    }
    const expectedShares =
      quote.expectedShares === undefined
        ? undefined
        : integerString(quote.expectedShares, "expectedShares");
    const expectedNetProceeds =
      quote.expectedProceeds === undefined
        ? undefined
        : integerString(quote.expectedProceeds, "expectedProceeds");
    if (
      (action === "buy" && !expectedShares) ||
      (action === "sell" && !expectedNetProceeds)
    ) {
      throw new StrykeSdkError("validation", "Quote output does not match its action");
    }

    const programId = text(quote.programId, "programId");
    const mathVersion = text(quote.mathVersion, "mathVersion");
    if (programId !== SUPPORTED_PROGRAM_ID || mathVersion !== SUPPORTED_QUOTE_MATH_VERSION) {
      throw new StrykeSdkError("compatibility", "Quote was produced by an unsupported contract or math version", false, {
        programId,
        mathVersion,
      });
    }

    const grossAmount = integerString(quote.grossAmount, "grossAmount");
    const feeAmount = integerString(quote.feeAmount, "feeAmount");
    const netAmount = integerString(quote.netAmount, "netAmount");
    const sharesIn = quote.sharesIn === undefined
      ? undefined
      : integerString(quote.sharesIn, "sharesIn");
    const sharesOut = quote.sharesOut === undefined
      ? undefined
      : integerString(quote.sharesOut, "sharesOut");
    const averageExecutionPriceBps = integerString(
      quote.averageExecutionPriceBps,
      "averageExecutionPriceBps"
    );
    const postTradeSideReserve = integerString(
      quote.postTradeSideReserve,
      "postTradeSideReserve"
    );
    const postTradeSideShares = integerString(
      quote.postTradeSideShares,
      "postTradeSideShares"
    );
    const quoteSlot = quote.quoteSlot === undefined
      ? undefined
      : integerString(quote.quoteSlot, "quoteSlot");
    const parsedFee = integerString(quote.fee, "fee");
    if (
      feeAmount !== parsedFee ||
      (action === "buy" && (grossAmount !== amount || sharesOut !== expectedShares || sharesIn !== undefined)) ||
      (action === "sell" && (sharesIn !== amount || netAmount !== expectedNetProceeds || sharesOut !== undefined))
    ) {
      throw new StrykeSdkError("api_response", "Canonical quote economics are inconsistent");
    }

    const responseAmount = integerString(quote.amount, "amount");
    if (responseAmount !== amount) {
      throw new StrykeSdkError("api_response", "Quote amount does not match request");
    }
    const appliedSlippage = integer(
      quote.maximumSlippageBpsApplied,
      "maximumSlippageBpsApplied"
    );
    if (appliedSlippage !== maximumSlippageBps || appliedSlippage < 0 || appliedSlippage > 9_999) {
      throw new StrykeSdkError("api_response", "Quote slippage bound does not match request");
    }
    const output = BigInt(expectedShares ?? expectedNetProceeds!);
    const minimumOutput = integerString(quote.minimumOutput, "minimumOutput");
    if ((output * BigInt(10_000 - appliedSlippage)) / 10_000n !== BigInt(minimumOutput)) {
      throw new StrykeSdkError("api_response", "Quote minimum output violates slippage rule");
    }
    const marketStateSlot =
      quote.marketStateSlot === undefined
        ? undefined
        : integer(quote.marketStateSlot, "marketStateSlot");
    const economics = principalBackedEconomics(quote.economics);
    const quotedTradeValuation = positionValuation(
      quote.quotedTradeValuation,
      "quotedTradeValuation"
    );
    const resultingPositionValuation = positionValuation(
      quote.resultingPositionValuation,
      "resultingPositionValuation"
    );
    const authoritativeValuation =
      quotedTradeValuation ?? resultingPositionValuation;
    if (
      economics.grossAmount !== grossAmount ||
      economics.tradeFee !== feeAmount ||
      (action === "buy" &&
        (economics.netPrincipalDelta !== (BigInt(amount) - BigInt(feeAmount)).toString() ||
          economics.participationUnitsDelta !== expectedShares)) ||
      (action === "sell" &&
        (economics.participationUnitsDelta !== `-${amount}` ||
          economics.executableCurrentValue !== expectedNetProceeds)) ||
      (authoritativeValuation !== undefined &&
        ((authoritativeValuation.winningPayoutCollateralUnits !== undefined &&
          economics.projectedWinningPayout !==
            authoritativeValuation.winningPayoutCollateralUnits) ||
          (authoritativeValuation.currentPnlCollateralUnits !== undefined &&
            economics.currentPnl !== authoritativeValuation.currentPnlCollateralUnits) ||
          (authoritativeValuation.profitIfWinsCollateralUnits !== undefined &&
            economics.profitIfWins !==
              authoritativeValuation.profitIfWinsCollateralUnits)))
    ) {
      throw new StrykeSdkError(
        "api_response",
        "Principal-backed quote economics are inconsistent"
      );
    }

    return {
      quoteId: text(quote.quoteId, "quoteId"),
      generatedAt,
      expiresAt,
      marketStateVersion: text(quote.marketStateVersion, "marketStateVersion"),
      ...(marketStateSlot === undefined ? {} : { marketStateSlot }),
      action,
      side,
      amount: responseAmount,
      programId: SUPPORTED_PROGRAM_ID,
      mathVersion: SUPPORTED_QUOTE_MATH_VERSION,
      ...(quoteSlot === undefined ? {} : { quoteSlot }),
      fee: parsedFee,
      grossAmount,
      feeAmount,
      netAmount,
      ...(sharesIn === undefined ? {} : { sharesIn }),
      ...(sharesOut === undefined ? {} : { sharesOut }),
      averageExecutionPriceBps,
      postTradeSideReserve,
      postTradeSideShares,
      feeBreakdown: feeBreakdown(quote.feeBreakdown),
      closingProtection: protection,
      ...(expectedShares === undefined ? {} : { expectedShares }),
      ...(expectedNetProceeds === undefined ? {} : { expectedNetProceeds }),
      minimumOutput,
      maximumSlippageBpsApplied: appliedSlippage,
      executableProbabilityBps: integer(
        quote.executionPriceBps,
        "executionPriceBps"
      ),
      normalizedSideProbabilityBps: integer(
        quote.executionPriceBps,
        "executionPriceBps"
      ),
      priceImpactBps: integer(quote.priceImpactBps, "priceImpactBps"),
      economics,
      ...(quotedTradeValuation === undefined ? {} : { quotedTradeValuation }),
      ...(resultingPositionValuation === undefined
        ? {}
        : { resultingPositionValuation }),
      raw: quote,
    };
  }

  async sellAvailable({
    market,
    side,
    ownedShares,
    maximumSlippageBps,
    owner,
  }: {
    market: PilotMarket;
    side: QuoteSide;
    ownedShares: string;
    maximumSlippageBps: number;
    owner: string;
  }): Promise<ExecutableQuote> {
    const owned = BigInt(integerString(ownedShares, "ownedShares"));
    if (owned <= 0n) {
      throw new StrykeSdkError("validation", "Owned shares must be positive");
    }
    return this.sell({
      market,
      side,
      amount: owned.toString(),
      maximumSlippageBps,
      owner,
    });
  }

  buy(input: Omit<Parameters<QuotesClient["get"]>[0], "action">) {
    return this.get({ ...input, action: "buy" });
  }

  sell(input: Omit<Parameters<QuotesClient["get"]>[0], "action">) {
    return this.get({ ...input, action: "sell" });
  }
}
