import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PilotMarket } from "@stryketrade/sdk";
import { afterEach, describe, expect, it } from "vitest";

import { runMarketTick, type ReferenceBotRuntimeAdapter } from "../src/bot.js";
import { parseReferenceBotConfig } from "../src/config.js";
import { createPaperRuntimeAdapter, FilePaperLedger } from "../src/paper-ledger.js";
import { quote } from "./fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const market = (state: "open" | "trading_closed"): PilotMarket => ({
  marketId: "btc:paper-round",
  asset: "BTC",
  expiryFamily: "five_minute",
  expiryTs: 1_900_000_000,
  strikePrice: "100",
  pools: { yes: "1000000", no: "1000000", stale: false },
  activation: { yes: { realPoolCollateralUnits: "1000000" }, no: { realPoolCollateralUnits: "1000000" } },
  intervalLifecycle: state === "open" ? "active" : "closed",
  lifecycle: { state, rawState: state, rawReason: state, observedAt: new Date().toISOString(), source: "api_v1" },
  reference: { alignmentStatus: "aligned", assetKey: "btc" },
  raw: {},
} as never);

describe("durable paper runtime", () => {
  it("persists buy, survives restart, and reports winning and losing paper settlement once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stryke-paper-ledger-"));
    directories.push(directory);
    const ledgerPath = join(directory, "ledger.json");
    let marketState: "open" | "trading_closed" = "open";
    let paperOutcome: "yes" | "no" = "yes";
    const config = parseReferenceBotConfig({
      estimator: "distance_to_strike",
      readOnlyMode: true,
      liveTradingEnabled: false,
      killSwitchEnabled: true,
    });
    const base: ReferenceBotRuntimeAdapter = {
      loadCheckpoint: async () => undefined,
      reconcilePending: async (checkpoint) => ({ state: "confirmed", clientActionId: checkpoint.clientActionId }),
      listPositions: async () => [],
      loadMarketByIdentity: async () => market(marketState),
      resolvePaperOutcome: async () => paperOutcome,
      evaluatePosition: async () => { throw new Error("paper positions hold to expiry"); },
      evaluateEntry: async () => ({
        market: market("open"),
        estimatorInput: { currentPrice: 101, strikePrice: 100, secondsRemaining: 120, priceHistory: [{ price: 99, publishTime: 1 }, { price: 100, publishTime: 2 }] },
        buyQuotes: [
          quote({ side: "yes", amount: "10000", grossAmount: "10000", expectedShares: "20000", executableProbabilityBps: 4000, economics: { ...quote().economics, grossAmount: "10000", projectedWinningPayout: "20000" } }),
          quote({ side: "no", amount: "10000", grossAmount: "10000", expectedShares: "10000", executableProbabilityBps: 6000 }),
        ],
        proposedSizeLamports: 10_000n,
        aggregateExposureLamports: 0n,
        openPositions: 0,
        dataFresh: true,
      }),
      executeBuy: async () => { throw new Error("paper runtime must not submit a live buy"); },
      executeSell: async () => { throw new Error("paper runtime must not submit a live sell"); },
      executeTerminal: async () => { throw new Error("paper runtime must not submit a live terminal action"); },
    };

    const firstProcess = createPaperRuntimeAdapter(base, new FilePaperLedger(ledgerPath));
    await expect(runMarketTick({ tick: 1, config, adapter: firstProcess })).resolves.toMatchObject({ action: "paper_buy", reason: "entry_edge_and_safety_passed_paper_simulated" });

    const restartedProcess = createPaperRuntimeAdapter(base, new FilePaperLedger(ledgerPath));
    await expect(runMarketTick({ tick: 2, config, adapter: restartedProcess })).resolves.toMatchObject({ action: "paper_hold", reason: "paper_hold_to_expiry" });

    marketState = "trading_closed";
    await expect(restartedProcess.listPositions()).resolves.toMatchObject([{ lifecycle: { state: "claimable" } }]);
    await expect(runMarketTick({ tick: 3, config, adapter: restartedProcess })).resolves.toMatchObject({ action: "paper_claim", reason: "paper_terminal_simulated" });
    await expect(runMarketTick({ tick: 4, config, adapter: restartedProcess })).resolves.toMatchObject({ action: "paper_buy" });
    paperOutcome = "no";
    await expect(runMarketTick({ tick: 5, config, adapter: restartedProcess })).resolves.toMatchObject({ action: "paper_loss", reason: "paper_terminal_simulated" });
    await expect(runMarketTick({ tick: 6, config, adapter: restartedProcess })).resolves.toMatchObject({ action: "paper_buy" });

    const stored = await new FilePaperLedger(ledgerPath).load();
    expect(stored.positions.map(({ state }) => state)).toEqual(["claimed", "lost", "open"]);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600);
  });
});
