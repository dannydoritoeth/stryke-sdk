import { describe, expect, it } from "vitest";
import { MemoryActionCheckpointStore, PYTH_FEED_IDS, PriceStore } from "@stryke/sdk";

import { runMarketTick } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";
import { createSdkRuntimeAdapter } from "../src/sdk-runtime.js";

describe("SDK runtime composition", () => {
  it("actual_sdk_tick_consumes_market_side_size_slippage_estimator_and_risk_config", async () => {
    const now = Date.now();
    const config = parseReferenceBotConfig({
      asset: "SOL", expiryFamily: "one_minute", side: "no", estimator: "distance_momentum",
      tradeSizeLamports: 1_234_567n, maximumTradeSizeLamports: 2_000_000n,
      maximumAggregateExposureLamports: 3_000_000n, minimumEntryEdgeBps: 9_999,
      maximumPriceImpactBps: 77, minimumSecondsToExpiry: 10, maximumOpenPositions: 1,
      tickIntervalMs: 1_234, stopLossBps: 321, takeProfitBps: 654,
      priceHistoryMaxPoints: 2, killSwitchEnabled: false,
    });
    const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const client = {
      requestJson: async (path: string, init?: RequestInit) => {
        calls.push({ path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (path.startsWith("/v1/markets?")) return {
          markets: [{
            marketId: "sol-1m", assetRef: "sol-feed", symbol: "SOL", source: "pyth_oracle",
            collateral: { symbol: "SOL", mint: "11111111111111111111111111111111" }, expiryFamily: "one_minute",
            expiryTs: Math.floor(now / 1_000) + 60, targetValue: "10000000000", status: "open", rawStatus: "active",
            pilotLifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state: "open", rawStatus: "active", rawReason: "market_open", observedAt: new Date(now).toISOString() },
            tradeability: { canQuote: true, canPrepareTransaction: true, disabledReasons: [] },
            selectedMarket: { pools: { yesPool: "10", noPool: "10", stale: false }, odds: { yesBps: 5000, noBps: 5000 } },
          }],
          metadata: { contractVersion: "stryke.botMarket.v1", generatedAt: new Date(now).toISOString(), stale: false },
        };
        return {
          quote: { quoteId: "quote-1", generatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(), marketStateVersion: "state-1", amount: "1234567", fee: "0", feeBreakdown: { feeMode: "waived", normalTradingFeeWaivedCollateralUnits: "0", grossTradeFeeCollateralUnits: "0", normalTradingFeeBps: 0, feeBpsApplied: 0 }, expectedShares: "1234567", minimumOutput: "1225060", maximumSlippageBpsApplied: 77, executionPriceBps: 5000, priceImpactBps: 1 },
          metadata: { stale: false },
        };
      },
    };
    const store = new PriceStore({ now: () => now, maximumHistoryPoints: 2 });
    const id = PYTH_FEED_IDS.SOL.slice(2);
    for (const [price, publishTime] of [["9900000000", Math.floor(now / 1_000) - 1], ["10000000000", Math.floor(now / 1_000)]] as const) {
      store.ingest("SOL", { parsed: [{ id, price: { price, expo: -8, publish_time: publishTime } }] });
    }
    const adapter = createSdkRuntimeAdapter({ client: client as never, rpc: {} as never, priceStore: store, checkpoint: new MemoryActionCheckpointStore(), config, now: () => now });
    await expect(runMarketTick({ tick: 1, config, adapter })).resolves.toMatchObject({ phase: "entry", action: "skip", reason: "edge", marketId: "sol-1m" });
    expect(calls[0]!.path).toContain("symbol=SOL");
    expect(calls[0]!.path).toContain("expiryFamily=one_minute");
    expect(calls[1]!.body).toMatchObject({ action: "buy", side: "no", amount: "1234567", maxSlippageBps: 77 });
  });
});
