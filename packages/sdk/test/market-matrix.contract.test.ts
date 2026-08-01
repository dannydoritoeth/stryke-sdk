import { describe, expect, it } from "vitest";

import {
  MarketsClient,
  QuotesClient,
  SUPPORTED_PROGRAM_ID,
  SUPPORTED_QUOTE_MATH_VERSION,
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
              tokenMint: "So11111111111111111111111111111111111111112",
              symbol: asset,
              source: "pyth_oracle",
              collateral: { symbol: "SOL" },
              expiryFamily,
              expiryTs,
              intervalStartTs: expiryTs - EXPIRY_SECONDS[expiryFamily],
              intervalLifecycle: "active",
              targetValue: asset === "BTC" ? "70000" : "150",
              marketReference: expiryFamily === "one_minute" ? {
                assetKey: asset.toLowerCase(),
                expiryFamily,
                intervalStartTs: expiryTs - EXPIRY_SECONDS[expiryFamily],
                intervalEndTs: expiryTs,
                policy: "stryke_open",
                alignmentStatus: "native",
                status: "locked",
                targetValue: asset === "BTC" ? "70000" : "150",
                targetDecimals: 8,
                observedAt: new Date(now).toISOString(),
              } : {
                assetKey: asset.toLowerCase(),
                expiryFamily,
                intervalStartTs: expiryTs - EXPIRY_SECONDS[expiryFamily],
                intervalEndTs: expiryTs,
                policy: "polymarket",
                alignmentStatus: "aligned",
                status: "locked",
                targetValue: asset === "BTC" ? "70000" : "150",
                targetDecimals: 8,
                observedAt: new Date(now).toISOString(),
                externalVenue: "polymarket",
                externalMarketId: `poly-${asset}-${expiryFamily}-${expiryTs}`,
                externalSlug: `${asset.toLowerCase()}-${expiryFamily}-${expiryTs}`,
                upTokenId: "poly-up",
                downTokenId: "poly-down",
              },
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
                activation: {
                  yes: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "500000000", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
                  no: { activated: false, thresholdCollateralUnits: "10000000000", realPoolCollateralUnits: "500000000", feeModeForNextBuy: "activation_waived", feeModeForNextSell: "activation_waived" },
                },
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
        tokenMint: "So11111111111111111111111111111111111111112",
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
          programId: SUPPORTED_PROGRAM_ID,
          mathVersion: SUPPORTED_QUOTE_MATH_VERSION,
          amount: "1000000000",
          fee: "10000000",
          grossAmount: "1000000000",
          feeAmount: "10000000",
          netAmount: "990000000",
          sharesOut: "1250000000",
          averageExecutionPriceBps: "8000",
          postTradeSideReserve: "1000000000",
          postTradeSideShares: "1250000000",
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
            closingStartsAt: expiryTs - 30,
            hardLockTs: expiryTs - 5,
            secondsUntilLock: EXPIRY_SECONDS[expiryFamily] - 5,
          },
          expectedShares: "1250000000",
          minimumOutput: "1237500000",
          maximumSlippageBpsApplied: 100,
          executionPriceBps: 8000,
          priceImpactBps: 25,
          economics: {
            economicVersion: 2,
            grossAmount: "1000000000",
            tradeFee: "10000000",
            netPrincipalDelta: "990000000",
            participationUnitsDelta: "1250000000",
            remainingPrincipal: "990000000",
            desiredCurveValue: "990000000",
            backedPremium: "0",
            surplusDelta: "0",
            executableCurrentValue: "990000000",
            projectedWinningPayout: "990000000",
            currentPnl: "0",
            profitIfWins: "0",
          },
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
    pools: { yes: "500000000", no: "500000000", stale: false },
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
