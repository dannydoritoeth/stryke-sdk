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
  tokenMint: "So11111111111111111111111111111111111111112",
  source: "pyth_oracle",
  collateral: "SOL",
  expiryFamily: "five_minute",
  expiryTs: 1_800_000_000,
  intervalStartTs: 1_799_999_700,
  intervalLifecycle: "active",
  strikePrice: "7000000000000",
  strikePriceDecimal: 70000,
  status: "open",
  reference: {
    assetKey: "btc",
    expiryFamily: "five_minute",
    intervalStartTs: 1_799_999_700,
    intervalEndTs: 1_800_000_000,
    policy: "polymarket",
    alignmentStatus: "aligned",
    status: "locked",
    targetValue: "7000000000000",
    targetDecimals: 8,
    observedAt: "2026-07-22T00:00:00.000Z",
    externalVenue: "polymarket",
    externalMarketId: "poly-btc-5m",
    upTokenId: "poly-up",
    downTokenId: "poly-down",
  },
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
  pools: { yes: "0 SOL", no: "0 SOL", stale: false },
  activation: {
    yes: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "0", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
    no: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "0", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
  },
  probability: { yesBps: 5000, noBps: 5000 },
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
    closingProtection: {
      policyVersion: 1,
      phase: "open",
      baseFeeBps: 100,
      closingFeeBps: 0,
      effectiveFeeBps: 100,
      hardLockTs: 1_799_999_995,
      secondsUntilLock: 295,
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

  it("sell_available_reduces_only_amount_unavailable_quotes", async () => {
    const requested: string[] = [];
    const client = {
      requestJson: async (_path: string, init: { body: string }) => {
        const amount = JSON.parse(init.body).amount as string;
        requested.push(amount);
        if (amount === "1000000000") {
          return {
            quote: {
              amount,
              stale: true,
              unavailableReason: "Quote is unavailable for this amount.",
              closingProtection: responseBody("sell").quote.closingProtection,
            },
            metadata: { stale: true },
          };
        }
        return {
          ...responseBody("sell"),
          quote: { ...responseBody("sell").quote, amount },
        };
      },
    };
    const quotes = new QuotesClient(client as never, () => Date.parse("2026-07-22T00:00:01Z"));
    await expect(quotes.sellAvailable({ market, side: "yes", ownedShares: "1000000000", maximumSlippageBps: 100 }))
      .resolves.toMatchObject({ amount: "990000000", action: "sell" });
    expect(requested).toEqual(["1000000000", "990000000"]);
  });

  it("sell_available_does_not_mask_non_amount_failures", async () => {
    const client = {
      requestJson: async () => ({
        quote: {
          amount: "1000000000",
          stale: true,
          unavailableReason: "Trading is locked before settlement.",
          closingProtection: { ...responseBody("sell").quote.closingProtection, phase: "locked" },
        },
        metadata: { stale: true },
      }),
    };
    const quotes = new QuotesClient(client as never);
    await expect(quotes.sellAvailable({ market, side: "yes", ownedShares: "1000000000", maximumSlippageBps: 100 }))
      .rejects.toMatchObject({ code: "quote_blocked", message: "Trading is locked before settlement." });
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
        quote: {
          amount: "1",
          stale: true,
          unavailableReason: "stale",
          closingProtection: responseBody("buy").quote.closingProtection,
        },
        metadata: { stale: true },
      }),
    } as never);
    await expect(
      stale.buy({ market, side: "yes", amount: "1", maximumSlippageBps: 0 })
    ).rejects.toBeInstanceOf(StrykeSdkError);
  });

  it("closing_quote_exposes_exact_effective_fee", async () => {
    const client = {
      requestJson: async () => ({
        ...responseBody("buy"),
        quote: {
          ...responseBody("buy").quote,
          fee: "70000000",
          feeBreakdown: {
            ...responseBody("buy").quote.feeBreakdown,
            feeMode: "closing",
            grossTradeFeeCollateralUnits: "70000000",
            feeBpsApplied: 700,
          },
          closingProtection: {
            ...responseBody("buy").quote.closingProtection,
            phase: "closing",
            closingFeeBps: 700,
            effectiveFeeBps: 700,
            secondsUntilLock: 8,
          },
        },
      }),
    };
    await expect(
      new QuotesClient(client as never, () => Date.parse("2026-07-22T00:00:01Z")).buy({
        market, side: "yes", amount: "1000000000", maximumSlippageBps: 100,
      })
    ).resolves.toMatchObject({
      closingProtection: { phase: "closing", effectiveFeeBps: 700 },
      feeBreakdown: { feeMode: "closing", feeBpsApplied: 700 },
    });
  });

  it("locked_quote_is_non_retryable_and_missing_policy_fails_closed", async () => {
    const locked = new QuotesClient({
      requestJson: async () => ({
        quote: {
          amount: "1",
          stale: false,
          unavailableReason: "Trading is locked before settlement.",
          closingProtection: {
            ...responseBody("buy").quote.closingProtection,
            phase: "locked",
            secondsUntilLock: 0,
          },
        },
        metadata: { stale: false },
      }),
    } as never);
    await expect(
      locked.buy({ market, side: "yes", amount: "1", maximumSlippageBps: 0 })
    ).rejects.toMatchObject({
      code: "quote_blocked",
      retryable: false,
      context: { phase: "locked", policyVersion: 1 },
    });
    const missing = new QuotesClient({
      requestJson: async () => ({ ...responseBody("buy"), quote: { ...responseBody("buy").quote, closingProtection: undefined } }),
    } as never);
    await expect(
      missing.buy({ market, side: "yes", amount: "1000000000", maximumSlippageBps: 100 })
    ).rejects.toMatchObject({ code: "api_response" });
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

  it.each(["upcoming", "locked", "closed"] as const)(
    "blocks_%s_market_before_request_and_allows_a_refreshed_active_market",
    async (intervalLifecycle) => {
      let requests = 0;
      const quotes = new QuotesClient({
        requestJson: async () => {
          requests += 1;
          return responseBody("buy");
        },
      } as never, () => Date.parse("2026-07-22T00:00:01Z"));
      const blocked = {
        ...market,
        intervalLifecycle,
        tradeability: {
          ...market.tradeability,
          canQuote: false,
          canPrepareTransaction: false,
          disabledReasons: ["outside_trading_interval"],
        },
      } satisfies PilotMarket;

      await expect(quotes.buy({
        market: blocked,
        side: "yes",
        amount: "1000000000",
        maximumSlippageBps: 100,
      })).rejects.toMatchObject({ code: "quote_blocked" });
      expect(requests).toBe(0);

      await expect(quotes.buy({
        market,
        side: "yes",
        amount: "1000000000",
        maximumSlippageBps: 100,
      })).resolves.toMatchObject({ quoteId: "quote_v1_123" });
      expect(requests).toBe(1);
    }
  );
});
