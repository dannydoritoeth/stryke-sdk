import { describe, expect, it } from "vitest";

import {
  MarketsClient,
  QuotesClient,
  type PilotAsset,
  type PilotExpiryFamily,
} from "../src/index.js";

const EXPIRY_SECONDS: Record<PilotExpiryFamily, number> = {
  one_minute: 60,
  five_minute: 300,
  fifteen_minute: 900,
  hourly: 3_600,
};

const contractCase = (
  asset: PilotAsset,
  expiryFamily: PilotExpiryFamily
) => async () => {
  const now = Date.parse("2026-07-22T00:00:00.000Z");
  const expiryTs = Math.floor(now / 1_000) + EXPIRY_SECONDS[expiryFamily];
  const assetRef = `${asset.toLowerCase()}-pyth-feed`;
  const client = {
    requestJson: async (path: string, init?: RequestInit) => {
      if (path.startsWith("/v1/markets?")) {
        const query = new URL(path, "https://pilot.example").searchParams;
        expect(query.get("symbol")).toBe(asset);
        expect(query.get("expiryFamily")).toBe(expiryFamily);
        expect(query.get("sourceFamily")).toBe("pyth");
        expect(query.get("collateral")).toBe("SOL");
        return {
          markets: [
            {
              marketId: `pyth:${asset}:${expiryFamily}:${expiryTs}`,
              assetRef,
              symbol: asset,
              source: "pyth_oracle",
              collateral: { symbol: "SOL" },
              expiryFamily,
              expiryTs,
              targetValue: asset === "BTC" ? "7000000000000" : "15000000000",
              status: "open",
              rawStatus: "active",
              pilotLifecycle: {
                schemaVersion: "stryke.pilotLifecycle.v1",
                state: "open",
                rawStatus: "active",
                rawReason: "market_open",
                observedAt: new Date(now).toISOString(),
                observedSlot: 123,
              },
              tradeability: {
                canQuote: true,
                canPrepareTransaction: true,
                disabledReasons: [],
              },
              selectedMarket: {
                pools: { yesPool: "500000000", noPool: "500000000", stale: false },
                odds: { yesBps: 5000, noBps: 5000 },
              },
            },
          ],
          metadata: {
            contractVersion: "stryke.botMarket.v1",
            generatedAt: new Date(now).toISOString(),
            stale: false,
          },
        };
      }

      expect(path).toBe("/v1/quote");
      const request = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(request.market).toMatchObject({
        tokenMint: assetRef,
        source: "pyth_oracle",
        expiryFamily,
        expiryTs,
      });
      return {
        quote: {
          quoteId: `quote-${asset}-${expiryFamily}`,
          generatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 5_000).toISOString(),
          marketStateVersion: `state-${asset}-${expiryFamily}`,
          amount: "1000000000",
          fee: "10000000",
          feeBreakdown: {
            feeMode: "standard",
            normalTradingFeeWaivedCollateralUnits: "0",
            grossTradeFeeCollateralUnits: "10000000",
            normalTradingFeeBps: 100,
            feeBpsApplied: 100,
          },
          expectedShares: "1250000000",
          minimumOutput: "1237500000",
          maximumSlippageBpsApplied: 100,
          executionPriceBps: 8000,
          priceImpactBps: 25,
          stale: false,
        },
        metadata: { stale: false },
      };
    },
  };

  const market = await new MarketsClient(client as never).current(
    asset,
    expiryFamily
  );
  const quote = await new QuotesClient(client as never, () => now).buy({
    market,
    side: "yes",
    amount: "1000000000",
    maximumSlippageBps: 100,
  });

  expect(market).toMatchObject({
    asset,
    expiryFamily,
    source: "pyth_oracle",
    collateral: "SOL",
    strikePriceDecimal: asset === "BTC" ? 70_000 : 150,
    stale: false,
    pools: { yesCollateralUnits: "500000000", noCollateralUnits: "500000000", stale: false },
    probability: { yesBps: 5000, noBps: 5000 },
  });
  expect(quote).toMatchObject({
    action: "buy",
    expectedShares: "1250000000",
    minimumOutput: "1237500000",
    marketStateVersion: `state-${asset}-${expiryFamily}`,
  });
};

describe("pilot read/quote/evaluate asset and expiry contract", () => {
  it("btc_1m_read_quote_evaluate_contract", contractCase("BTC", "one_minute"));
  it("btc_5m_read_quote_evaluate_contract", contractCase("BTC", "five_minute"));
  it("btc_15m_read_quote_evaluate_contract", contractCase("BTC", "fifteen_minute"));
  it("btc_1h_read_quote_evaluate_contract", contractCase("BTC", "hourly"));
  it("sol_1m_read_quote_evaluate_contract", contractCase("SOL", "one_minute"));
  it("sol_5m_read_quote_evaluate_contract", contractCase("SOL", "five_minute"));
  it("sol_15m_read_quote_evaluate_contract", contractCase("SOL", "fifteen_minute"));
  it("sol_1h_read_quote_evaluate_contract", contractCase("SOL", "hourly"));
});
