import type { StrykeClient } from "./client.js";
import { StrykeSdkError } from "./errors.js";
import type { PilotMarket } from "./markets.js";

export type QuoteAction = "buy" | "sell";
export type QuoteSide = "yes" | "no";

export type QuoteFeeBreakdown = {
  feeMode: string;
  normalTradingFeeWaivedCollateralUnits: string;
  grossTradeFeeCollateralUnits: string;
  normalTradingFeeBps: number;
  feeBpsApplied: number;
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
  fee: string;
  feeBreakdown: QuoteFeeBreakdown;
  expectedShares?: string;
  expectedNetProceeds?: string;
  minimumOutput: string;
  maximumSlippageBpsApplied: number;
  executableProbabilityBps: number;
  priceImpactBps: number;
  raw: Readonly<Record<string, unknown>>;
};

const integerString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new StrykeSdkError("validation", `Invalid quote field: ${field}`);
  }
  return value;
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
  }: {
    market: PilotMarket;
    action: QuoteAction;
    side: QuoteSide;
    amount: string;
    maximumSlippageBps: number;
  }): Promise<ExecutableQuote> {
    integerString(amount, "amount");
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
          tokenMint: market.assetRef,
          source: market.source,
          collateral,
          expiryFamily: market.expiryFamily,
          expiryTs: market.expiryTs,
          targetValue: market.strikePrice,
        },
        action,
        side,
        amount,
        maxSlippageBps: maximumSlippageBps,
      }),
    });
    const quote = response.quote;
    if (response.metadata.stale || quote.stale === true || quote.unavailableReason) {
      throw new StrykeSdkError(
        quote.unavailableReason === "stale" ? "source_stale" : "quote_blocked",
        typeof quote.unavailableReason === "string"
          ? quote.unavailableReason
          : "Executable quote is stale or unavailable",
        true
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

    return {
      quoteId: text(quote.quoteId, "quoteId"),
      generatedAt,
      expiresAt,
      marketStateVersion: text(quote.marketStateVersion, "marketStateVersion"),
      ...(marketStateSlot === undefined ? {} : { marketStateSlot }),
      action,
      side,
      amount: responseAmount,
      fee: integerString(quote.fee, "fee"),
      feeBreakdown: feeBreakdown(quote.feeBreakdown),
      ...(expectedShares === undefined ? {} : { expectedShares }),
      ...(expectedNetProceeds === undefined ? {} : { expectedNetProceeds }),
      minimumOutput,
      maximumSlippageBpsApplied: appliedSlippage,
      executableProbabilityBps: integer(
        quote.executionPriceBps,
        "executionPriceBps"
      ),
      priceImpactBps: integer(quote.priceImpactBps, "priceImpactBps"),
      raw: quote,
    };
  }

  buy(input: Omit<Parameters<QuotesClient["get"]>[0], "action">) {
    return this.get({ ...input, action: "buy" });
  }

  sell(input: Omit<Parameters<QuotesClient["get"]>[0], "action">) {
    return this.get({ ...input, action: "sell" });
  }
}
