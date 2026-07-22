import { describe, expect, it } from "vitest";

import {
  QuotesClient,
  StrykeSdkError,
  assertQuoteUsable,
  type PilotMarket,
} from "../src/index.js";

const market = {
  marketId: "market-1",
  asset: "BTC",
  assetRef: "btc-feed",
  source: "pyth_oracle",
  collateral: "SOL",
  expiryFamily: "five_minute",
  expiryTs: 1_800_000_000,
  strikePrice: "7000000000000",
  status: "open",
  rawStatus: "active",
  generatedAt: "2026-07-22T00:00:00.000Z",
  lifecycle: {
    schemaVersion: "stryke.pilotLifecycle.v1",
    state: "open",
    rawStatus: "active",
    rawReason: "market_open",
    observedAt: "2026-07-22T00:00:00.000Z",
  },
  tradeability: {
    canQuote: true,
    canPrepareTransaction: true,
    disabledReasons: [],
  },
  stale: false,
  raw: { collateral: { type: "native_sol", symbol: "SOL", mint: "sol", decimals: 9 } },
} as const satisfies PilotMarket;

const responseBody = (action: "buy" | "sell") => ({
  quote: {
    quoteId: "quote_v1_123",
    generatedAt: "2026-07-22T00:00:00.000Z",
    expiresAt: "2026-07-22T00:00:05.000Z",
    marketStateVersion: "market_v1_123",
    amount: "1000000000",
    fee: "10000000",
    feeBreakdown: {
      feeMode: "standard",
      normalTradingFeeWaivedCollateralUnits: "0",
      grossTradeFeeCollateralUnits: "10000000",
      normalTradingFeeBps: 100,
      feeBpsApplied: 100,
    },
    ...(action === "buy"
      ? { expectedShares: "1981585268214571657" }
      : { expectedProceeds: "461934000" }),
    minimumOutput: action === "buy" ? "1961769415532425940" : "457314660",
    maximumSlippageBpsApplied: 100,
    executionPriceBps: 4996,
    priceImpactBps: action === "buy" ? 330 : 0,
    stale: false,
  },
  metadata: { stale: false },
});

describe("executable quote client", () => {
  const getQuote = async (action: "buy" | "sell") => {
    const client = {
      requestJson: async () => responseBody(action),
    };
    const quotes = new QuotesClient(client as never, () => Date.parse("2026-07-22T00:00:01Z"));
    return quotes.get({
      market,
      action,
      side: "yes",
      amount: "1000000000",
      maximumSlippageBps: 100,
    });
  };

  it("buy_quote_contains_complete_validity_and_economics_contract", async () => {
    await expect(getQuote("buy")).resolves.toMatchObject({
      action: "buy",
      quoteId: "quote_v1_123",
      expectedShares: "1981585268214571657",
      minimumOutput: "1961769415532425940",
      executableProbabilityBps: 4996,
      priceImpactBps: 330,
      feeBreakdown: { feeMode: "standard", feeBpsApplied: 100 },
    });
  });

  it("sell_quote_contains_net_proceeds_fees_impact_and_minimum_output", async () => {
    await expect(getQuote("sell")).resolves.toMatchObject({
      action: "sell",
      expectedNetProceeds: "461934000",
      minimumOutput: "457314660",
      executableProbabilityBps: 4996,
      priceImpactBps: 0,
      fee: "10000000",
      feeBreakdown: { feeMode: "standard", grossTradeFeeCollateralUnits: "10000000" },
    });
  });

  it("expired_quote_is_blocked", async () => {
    const expired = new QuotesClient(
      { requestJson: async () => responseBody("buy") } as never,
      () => Date.parse("2026-07-22T00:00:06Z")
    );
    await expect(
      expired.buy({ market, side: "yes", amount: "1", maximumSlippageBps: 0 })
    ).rejects.toMatchObject({ code: "quote_blocked" });
  });

  it("stale_quote_is_blocked", async () => {
    const stale = new QuotesClient({
      requestJson: async () => ({
        quote: { amount: "1", stale: true, unavailableReason: "stale" },
        metadata: { stale: true },
      }),
    } as never);
    await expect(
      stale.buy({ market, side: "yes", amount: "1", maximumSlippageBps: 0 })
    ).rejects.toBeInstanceOf(StrykeSdkError);
  });

  it("changed_market_state_version_is_blocked", async () => {
    const quote = await new QuotesClient(
      { requestJson: async () => responseBody("buy") } as never,
      () => Date.parse("2026-07-22T00:00:01Z")
    ).buy({ market, side: "yes", amount: "1000000000", maximumSlippageBps: 100 });
    expect(() =>
      assertQuoteUsable(quote, {
        marketStateVersion: "market_v1_changed",
        now: Date.parse("2026-07-22T00:00:02Z"),
      })
    ).toThrowError(expect.objectContaining({ code: "quote_blocked" }));
  });

  it("minimum_output_matches_slippage_rule", async () => {
    const client = {
      requestJson: async () => ({
        ...responseBody("buy"),
        quote: { ...responseBody("buy").quote, minimumOutput: "1" },
      }),
    };
    await expect(
      new QuotesClient(client as never, () => Date.parse("2026-07-22T00:00:01Z")).buy({
        market,
        side: "yes",
        amount: "1000000000",
        maximumSlippageBps: 100,
      })
    ).rejects.toMatchObject({ code: "api_response" });
  });

  it("large_integer_amounts_roundtrip_without_number_coercion", async () => {
    const amount = "18446744073709551615";
    const expectedShares = "184467440737095516150";
    const client = {
      requestJson: async () => ({
        ...responseBody("buy"),
        quote: {
          ...responseBody("buy").quote,
          amount,
          expectedShares,
          minimumOutput: "182622766329724560988",
        },
      }),
    };
    await expect(
      new QuotesClient(client as never, () => Date.parse("2026-07-22T00:00:01Z")).buy({
        market,
        side: "yes",
        amount,
        maximumSlippageBps: 100,
      })
    ).resolves.toMatchObject({ amount, expectedShares });
  });
});
