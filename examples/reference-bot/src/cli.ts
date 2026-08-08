import {
  FileActionCheckpointStore,
  PositionsClient,
  PriceStore,
  ReviewedTransactionExecutor,
  SDK_VERSION,
  SUPPORTED_API_SCHEMA_VERSION,
  SUPPORTED_API_VERSION,
  SUPPORTED_PROGRAM_ID,
  SUPPORTED_PROGRAM_VERSION,
  SUPPORTED_QUOTE_MATH_VERSION,
  SolanaReviewedExecutionAdapter,
  StrykeClient,
  StrykeSdkError,
  TransactionsClient,
  subscribeHermes,
  seedHermesHistory,
  type ActionCheckpointStore,
  type ExecutableQuote,
  type PilotPosition,
} from "@stryke/sdk";
import { createSolanaRpc, isTransactionSigner, type TransactionSigner } from "@solana/kit";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runReferenceBot } from "./bot.js";
import { parseReferenceBotConfig, parseReferenceBotEnv, publicConfig, resolveReferenceBotRuntimeBindings, type ReferenceBotProfile } from "./config.js";
import { emitPreflight, requireRootEnvFile, requiredExecutionBalance, runPreflightCheck } from "./preflight.js";
import { createSdkRuntimeAdapter } from "./sdk-runtime.js";
import { loadWalletForLiveTrading } from "./wallet.js";
import { PolymarketClient } from "./polymarket-client.js";
import { FileRoundDecisionStore } from "./round-state.js";
import { MemoryRoundDecisionStore } from "./round-state.js";
import type { RoundDecisionStore } from "./round-state.js";
import { PostgresReferenceBotState } from "./postgres-state.js";
import { requireRuntimeLease } from "./runtime-lease.js";

const compatibility = { sdkVersion: SDK_VERSION, apiVersion: SUPPORTED_API_VERSION, apiSchemaVersion: SUPPORTED_API_SCHEMA_VERSION, programId: SUPPORTED_PROGRAM_ID, programVersion: SUPPORTED_PROGRAM_VERSION };

const sampleQuote: ExecutableQuote = {
  quoteId: "read-only-smoke", generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  marketStateVersion: "documentation-smoke", action: "buy", side: "yes", amount: "10000000", fee: "0",
  programId: SUPPORTED_PROGRAM_ID, mathVersion: SUPPORTED_QUOTE_MATH_VERSION,
  grossAmount: "10000000", feeAmount: "0", netAmount: "10000000", sharesIn: "0", sharesOut: "20000000",
  averageExecutionPriceBps: "5000", postTradeSideReserve: "10000000", postTradeSideShares: "20000000",
  feeBreakdown: { feeMode: "activation_waived", normalTradingFeeWaivedCollateralUnits: "0", grossTradeFeeCollateralUnits: "0", normalTradingFeeBps: 0, feeBpsApplied: 0 },
  closingProtection: { policyVersion: 1, phase: "open", baseFeeBps: 0, closingFeeBps: 0, effectiveFeeBps: 0, closingStartsAt: 1_799_999_970, hardLockTs: 1_800_000_000, secondsUntilLock: 60 },
  expectedShares: "20000000", minimumOutput: "19800000", maximumSlippageBpsApplied: 100,
  executableProbabilityBps: 4800, normalizedSideProbabilityBps: 4800, priceImpactBps: 25,
  economics: { economicVersion: 2, grossAmount: "10000000", tradeFee: "0", netPrincipalDelta: "10000000", participationUnitsDelta: "20000000", remainingPrincipal: "10000000", desiredCurveValue: "10000000", backedPremium: "0", surplusDelta: "0", executableCurrentValue: "10000000", projectedWinningPayout: "10000000", currentPnl: "0", profitIfWins: "0" }, raw: {},
};

const runFixtureSmoke = async () => {
  const now = Math.floor(Date.now() / 1_000);
  const input = { currentPrice: 100_100, strikePrice: 100_000, secondsRemaining: 180, priceHistory: [{ price: 100_000, publishTime: now - 600 }, { price: 100_050, publishTime: now - 300 }, { price: 100_100, publishTime: now }] };
  const config = parseReferenceBotConfig({ killSwitchEnabled: false });
  let cycle = 0;
  await runReferenceBot({
    config,
    maximumTicks: 2,
    wait: async () => {},
    adapter: {
      loadCheckpoint: async () => undefined,
      reconcilePending: async () => ({ state: "confirmed", clientActionId: "unused" }),
      listPositions: async () => [],
      evaluatePosition: async () => { throw new StrykeSdkError("configuration", "fixture has no position"); },
      evaluateEntry: async () => {
        cycle += 1;
        if (cycle === 2) throw new StrykeSdkError("quote_blocked", "TradingLockedBeforeExpiry", false, { phase: "locked" });
        return {
          market: {
            marketId: "documentation-smoke", asset: config.asset, expiryFamily: config.expiryFamily,
            pools: { yes: "0 SOL", no: "0 SOL", stale: false },
            activation: { yes: { realPoolCollateralUnits: "0" }, no: { realPoolCollateralUnits: "0" } },
          } as never,
          estimatorInput: input,
          buyQuotes: [sampleQuote, { ...sampleQuote, quoteId: "read-only-smoke-no", side: "no", executableProbabilityBps: 6000, normalizedSideProbabilityBps: 6000 }],
          proposedSizeLamports: config.tradeSizeLamports,
          aggregateExposureLamports: 0n,
          openPositions: 0,
          dataFresh: true,
        };
      },
      executeBuy: async () => ({ clientActionId: "unused" }),
      executeSell: async () => ({ clientActionId: "unused" }),
      executeTerminal: async () => ({ clientActionId: "unused" }),
    },
  });
  console.log(JSON.stringify({ event: "stryke_compatibility", ...compatibility }));
};

const runPolymarketFixtureSmoke = async () => {
  const config = parseReferenceBotConfig({ strategy: "polymarket_early", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
  const rounds = new MemoryRoundDecisionStore();
  let step = 0;
  let marketId = "poly-round-1";
  const price = (bidBps: number, askBps: number) => ({ tokenId: "token", bidBps, askBps, spreadBps: askBps - bidBps, observedAtMs: Date.now() });
  const market = () => ({ marketId, intervalStartTs: Math.floor(Date.now() / 1_000) - 10, expiryTs: Math.floor(Date.now() / 1_000) + 290, strikePrice: "100", reference: { alignmentStatus: "aligned" }, pools: { yes: "1", no: "1", stale: false }, activation: { yes: { realPoolCollateralUnits: "1" }, no: { realPoolCollateralUnits: "1" } } }) as never;
  const buyQuote = (side: "yes" | "no", normalizedSideProbabilityBps: number): ExecutableQuote => ({ ...sampleQuote, quoteId: `buy-${side}`, side, amount: "1000000", grossAmount: "1000000", executableProbabilityBps: normalizedSideProbabilityBps, normalizedSideProbabilityBps, economics: { ...sampleQuote.economics, grossAmount: "1000000", projectedWinningPayout: "2000000" } });
  const { expectedShares: _unusedExpectedShares, ...sampleWithoutBuyOutput } = sampleQuote;
  const sellQuote: ExecutableQuote = { ...sampleWithoutBuyOutput, quoteId: "sell-yes", action: "sell", side: "yes", amount: "100", grossAmount: "100", feeAmount: "5", fee: "5", netAmount: "95", sharesIn: "100", sharesOut: "0", expectedNetProceeds: "95", executableProbabilityBps: 4000, normalizedSideProbabilityBps: 4000, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const position = { positionId: "position-1", owner: "owner", market: {}, yesShares: "100", noShares: "0", yesCostBasisCollateralUnits: "100", lifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state: "sellable", rawStatus: "active", rawReason: "position_sellable", observedAt: new Date().toISOString() }, raw: {} } as never;
  const adapter = {
    loadCheckpoint: async () => undefined,
    reconcilePending: async () => ({ state: "confirmed", clientActionId: "none" }),
    listPositions: async () => { step += 1; return step === 1 || step >= 4 ? [] : [position]; },
    evaluatePosition: async () => ({ market: market(), estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 120, priceHistory: [] }, sellQuote, ifWinPayout: "200", dataFresh: true, polymarketPrices: step === 2 ? { yes: price(6000, 6200), no: price(3500, 3800) } : { yes: price(4200, 4400), no: price(3500, 3800) } }),
    evaluateEntry: async () => ({ market: market(), estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 120, priceHistory: [] }, buyQuotes: [buyQuote("yes", 4000), buyQuote("no", 6000)] as const, proposedSizeLamports: config.tradeSizeLamports, aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true, polymarketPrices: { yes: price(5700, 6000), no: price(3500, 3800) } }),
    executeBuy: async () => ({ clientActionId: `buy-${marketId}` }),
    executeSell: async () => { await rounds.recordConvergenceExit(market()); return { clientActionId: "sell-poly-round-1" }; },
    executeTerminal: async () => ({ clientActionId: "none" }),
    hasConvergenceExitedRound: (candidate: Parameters<MemoryRoundDecisionStore["hasConvergenceExit"]>[0]) => rounds.hasConvergenceExit(candidate),
  };
  const first = await runReferenceBot({ config, adapter: adapter as never, maximumTicks: 4, wait: async () => {} });
  marketId = "poly-round-2";
  const second = await runReferenceBot({ config, adapter: adapter as never, once: true, wait: async () => {} });
  console.log(JSON.stringify({ event: "polymarket_fixture_complete", actions: [...first, ...second].map(({ action, reason }) => `${action}:${reason}`) }));
};

const runPolymarketLateFixtureSmoke = async () => {
  const config = parseReferenceBotConfig({ strategy: "polymarket_late", polymarketEarlyExitPolicy: "hold_to_expiry", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
  const rounds = new MemoryRoundDecisionStore();
  const now = Math.floor(Date.now() / 1_000);
  let step = 0;
  let marketId = "late-round-1";
  const market = () => ({ marketId, intervalStartTs: now - 270, expiryTs: now + 30, strikePrice: "100", reference: { alignmentStatus: "aligned" }, pools: { yes: "1", no: "1", stale: false }, activation: { yes: { realPoolCollateralUnits: "1" }, no: { realPoolCollateralUnits: "1" } } }) as never;
  const price = (askBps: number) => ({ tokenId: "token", bidBps: askBps - 100, askBps, spreadBps: 100, observedAtMs: Date.now() });
  const buyQuote = (side: "yes" | "no"): ExecutableQuote => ({ ...sampleQuote, quoteId: `late-${side}`, side, amount: "1000000", grossAmount: "1000000", economics: { ...sampleQuote.economics, grossAmount: "1000000", projectedWinningPayout: "2000000" }, closingProtection: { ...sampleQuote.closingProtection, closingStartsAt: now + 10, hardLockTs: now + 25 } });
  const open = { positionId: "late-position", owner: "owner", market: {}, yesShares: "100", noShares: "0", yesCostBasisCollateralUnits: "100", lifecycle: { schemaVersion: "stryke.pilotLifecycle.v1", state: "sellable", rawStatus: "active", rawReason: "position_sellable", observedAt: new Date().toISOString() }, raw: {} } as PilotPosition;
  const terminal = { ...open, claimableAmount: "200", actionDeadline: new Date(Date.now() + 60_000).toISOString(), lifecycle: { ...open.lifecycle, state: "claimable" as const } } as PilotPosition;
  const adapter = {
    loadCheckpoint: async () => undefined,
    reconcilePending: async () => ({ state: "confirmed", clientActionId: "none" }),
    listPositions: async () => { step += 1; return step === 1 || step >= 4 ? [] : [step === 3 ? terminal : open]; },
    evaluatePosition: async () => ({ market: market(), estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 10, priceHistory: [] }, sellQuote: buyQuote("yes"), ifWinPayout: "200", dataFresh: true, polymarketPrices: { yes: price(6000), no: price(3800) } }),
    evaluateEntry: async () => ({ market: market(), estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 30, priceHistory: [] }, buyQuotes: [buyQuote("yes"), buyQuote("no")] as const, proposedSizeLamports: config.tradeSizeLamports, aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true, polymarketPrices: { yes: price(6000), no: price(3800) } }),
    executeBuy: async () => ({ clientActionId: `buy-${marketId}` }), executeSell: async () => ({ clientActionId: "unexpected-sell" }), executeTerminal: async () => ({ clientActionId: "claim-late-round-1" }),
    hasEnteredRound: (candidate: Parameters<MemoryRoundDecisionStore["hasEntry"]>[0]) => rounds.hasEntry(candidate),
    recordEnteredRound: (candidate: Parameters<MemoryRoundDecisionStore["recordEntry"]>[0]) => rounds.recordEntry(candidate),
  };
  const first = await runReferenceBot({ config, adapter: adapter as never, maximumTicks: 4, wait: async () => {} });
  marketId = "late-round-2";
  const second = await runReferenceBot({ config, adapter: adapter as never, once: true, wait: async () => {} });
  console.log(JSON.stringify({ event: "polymarket_late_fixture_complete", actions: [...first, ...second].map(({ action, reason }) => `${action}:${reason}`) }));
};

const runPolymarketBootstrapFixtureSmoke = async () => {
  const config = parseReferenceBotConfig({ strategy: "polymarket_early", readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: false });
  const rounds = new MemoryRoundDecisionStore();
  const now = Math.floor(Date.now() / 1_000);
  const market = { marketId: "bootstrap-round", intervalStartTs: now - 10, expiryTs: now + 290, reference: { alignmentStatus: "aligned" }, pools: { yes: "0", no: "0", stale: false }, activation: { yes: { realPoolCollateralUnits: "0" }, no: { realPoolCollateralUnits: "0" } } } as never;
  const buyQuote = (side: "yes" | "no"): ExecutableQuote => ({ ...sampleQuote, quoteId: `bootstrap-${side}`, side, amount: "1000000", grossAmount: "1000000", economics: { ...sampleQuote.economics, grossAmount: "1000000", projectedWinningPayout: "1000000" } });
  const price = (askBps: number) => ({ tokenId: "token", bidBps: askBps - 100, askBps, spreadBps: 100, observedAtMs: Date.now() });
  const adapter = {
    loadCheckpoint: async () => undefined, reconcilePending: async () => ({ state: "confirmed", clientActionId: "none" }), listPositions: async () => [],
    evaluatePosition: async () => { throw new StrykeSdkError("configuration", "fixture has no position"); },
    evaluateEntry: async () => ({ market, estimatorInput: { currentPrice: 100, strikePrice: 100, secondsRemaining: 280, priceHistory: [] }, buyQuotes: [buyQuote("yes"), buyQuote("no")] as const, proposedSizeLamports: config.tradeSizeLamports, aggregateExposureLamports: 0n, openPositions: 0, dataFresh: true, polymarketPrices: { yes: price(6_000), no: price(3_800) } }),
    executeBuy: async () => ({ clientActionId: "bootstrap-buy" }), executeSell: async () => ({ clientActionId: "none" }), executeTerminal: async () => ({ clientActionId: "none" }),
    hasEnteredRound: (candidate: Parameters<MemoryRoundDecisionStore["hasEntry"]>[0]) => rounds.hasEntry(candidate), recordEnteredRound: (candidate: Parameters<MemoryRoundDecisionStore["recordEntry"]>[0]) => rounds.recordEntry(candidate),
  };
  const events = await runReferenceBot({ config, adapter: adapter as never, maximumTicks: 2, wait: async () => {} });
  console.log(JSON.stringify({ event: "polymarket_bootstrap_fixture_complete", actions: events.map(({ action, reason }) => `${action}:${reason}`) }));
};

const loadSigner = async (config: ReturnType<typeof parseReferenceBotEnv>, walletAdapterPath?: string) => loadWalletForLiveTrading<TransactionSigner>(config, async (path) => {
  let module: { default?: unknown };
  try {
    module = (await import(pathToFileURL(walletAdapterPath ?? resolve(process.env.INIT_CWD ?? process.cwd(), path)).href)) as { default?: unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "adapter import failed";
    throw new StrykeSdkError("configuration", `Cannot load STRYKE_WALLET_ADAPTER_PATH: ${detail}`);
  }
  if (!module.default || typeof module.default !== "object" || !("address" in module.default) || !isTransactionSigner(module.default as { address: never })) {
    throw new StrykeSdkError("configuration", "Wallet adapter must default-export a Solana transaction signer");
  }
  return module.default as TransactionSigner;
});

const waitForPriceHistory = async (store: PriceStore, asset: "BTC" | "SOL", timeoutMs = 30_000) => {
  const started = Date.now();
  while (store.history(asset).length < 2) {
    if (Date.now() - started >= timeoutMs) throw new StrykeSdkError("source_unavailable", "Pyth did not provide two fresh ordered prices within 30 seconds", true);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

const selectedProfile = (): ReferenceBotProfile => {
  const value = process.argv.find((argument) => argument.startsWith("--profile="))?.split("=", 2)[1];
  if (value === "paper" || value === "devnet" || value === "live") return value;
  throw new StrykeSdkError("configuration", "Use --profile=paper, --profile=devnet, or --profile=live");
};

const selectedMaximumTicks = (): number | undefined => {
  const raw = process.argv.find((argument) => argument.startsWith("--ticks="))?.split("=", 2)[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 2) throw new StrykeSdkError("configuration", "--ticks must be an integer of at least 2");
  return value;
};

const runSdkBot = async (profile: ReferenceBotProfile) => {
  if (profile !== "live") requireRootEnvFile(profile);
  let config: ReturnType<typeof parseReferenceBotEnv>;
  try {
    config = parseReferenceBotEnv(process.env, profile);
  } catch (error) {
    if (profile !== "live") {
      emitPreflight(profile, "environment", "failed", error instanceof Error ? error.message : "Invalid .env configuration", "Compare .env with .env.example, correct the named value, and retry.");
    }
    throw error;
  }
  if (!config.apiBaseUrl) throw new StrykeSdkError("configuration", "STRYKE_API_BASE_URL is required for live-data mode");
  const bindings = resolveReferenceBotRuntimeBindings(config);
  console.log(JSON.stringify({ event: "reference_bot_config", config: publicConfig(config), ...compatibility }));
  const client = await runPreflightCheck(
    profile,
    "api",
    "Connected to a compatible Stryke API.",
    "Check STRYKE_API_BASE_URL and confirm the Stryke API is healthy and compatible.",
    () => StrykeClient.connect({ apiBaseUrl: bindings.apiBaseUrl! })
  );
  const lookbackSeconds = config.historyLookbackSeconds[config.expiryFamily];
  const priceStore = new PriceStore({ maximumHistoryPoints: config.priceHistoryMaxPoints, historyWindowMs: (lookbackSeconds + 60) * 1_000 });
  const pythEndpoint = bindings.pythHermesUrl;
  const pythRemediation = "Check STRYKE_PYTH_HERMES_URL and network access, then retry; do not substitute another price source.";
  const subscription = await runPreflightCheck(
    profile,
    "pyth",
    `Connected to Pyth for ${config.asset}.`,
    pythRemediation,
    () => subscribeHermes({ endpoint: pythEndpoint, assets: [config.asset], store: priceStore })
  );
  try {
    emitPreflight(profile, "pyth", "checking", `Waiting for two fresh ordered ${config.asset} Pyth prices.`);
    try {
      await waitForPriceHistory(priceStore, config.asset);
      emitPreflight(profile, "pyth", "passed", `Received two fresh ordered ${config.asset} Pyth prices.`);
      if (config.estimator === "volatility_adjusted_probability") {
        emitPreflight(profile, "pyth_history", "checking", `Loading ${lookbackSeconds}s of timestamped ${config.asset} Pyth history.`);
        await seedHermesHistory({ endpoint: pythEndpoint, asset: config.asset, store: priceStore, lookbackSeconds });
        emitPreflight(profile, "pyth_history", "passed", `Loaded timestamped ${config.asset} Pyth history for the configured volatility window.`);
      }
    } catch (error) {
      emitPreflight(profile, "pyth", "failed", error instanceof Error ? error.message : "Pyth startup failed", pythRemediation);
      throw error;
    }
    const signer = profile !== "paper"
      ? await runPreflightCheck(profile, "wallet", "Loaded the configured wallet adapter.", "Check STRYKE_WALLET_ADAPTER_PATH and STRYKE_WALLET_KEYPAIR_PATH; follow docs/quickstart.md to configure the wallet.", () => loadSigner(config, bindings.walletAdapterPath))
      : undefined;
    const rpc = createSolanaRpc(bindings.solanaRpcUrl);
    if (profile === "paper") {
      emitPreflight(profile, "wallet", "skipped", "Paper mode never loads a wallet.");
      emitPreflight(profile, "rpc", "skipped", "Paper mode makes no wallet RPC checks.");
      emitPreflight(profile, "funding", "skipped", "Paper mode requires no wallet funding.");
    } else if (signer) {
      const balance = await runPreflightCheck(
        profile,
        "rpc",
        `Connected to ${profile === "live" ? "mainnet" : "devnet"} RPC for wallet ${signer.address}.`,
        `Check STRYKE_SOLANA_RPC_URL and confirm the endpoint is reachable and set to ${profile === "live" ? "mainnet-beta" : "devnet"}.`,
        async () => (await rpc.getBalance(signer.address, { commitment: "confirmed" }).send()).value,
        { attempts: 3, retryDelayMs: 1_500, attemptTimeoutMs: 5_000 }
      );
      const minimumBalance = requiredExecutionBalance(config.maximumTradeSizeLamports);
      if (balance < minimumBalance) {
        const remediation = profile === "devnet"
          ? `Run \`solana airdrop 2 ${signer.address} --url devnet\`, then retry.`
          : `Fund wallet ${signer.address} with enough mainnet SOL for fees and the configured trade cap, then retry.`;
        emitPreflight(profile, "funding", "failed", `Wallet ${signer.address} has ${balance} lamports; at least ${minimumBalance} are required.`, remediation);
        throw new StrykeSdkError("configuration", remediation);
      }
      emitPreflight(profile, "funding", "passed", `Wallet ${signer.address} has enough SOL for the configured trade cap and execution buffer.`);
    }
    if (process.argv.includes("--preflight-only")) {
      console.log(JSON.stringify({ event: "reference_bot_preflight_complete", profile }));
      return;
    }
    const postgresState = config.stateBackend === "postgres"
      ? new PostgresReferenceBotState(
          { connectionString: config.stateDatabaseUrl },
          config.stateNamespace,
          config.leaseTtlMs
        )
      : undefined;
    if (postgresState) await postgresState.initialize();
    const checkpoint: ActionCheckpointStore = postgresState ?? new FileActionCheckpointStore(bindings.checkpointPath);
    let executor: ReviewedTransactionExecutor | undefined;
    if (signer) {
      const transactions = new TransactionsClient(client, rpc);
      const positions = new PositionsClient(client);
      const executionAdapter = new SolanaReviewedExecutionAdapter({ rpc, signer, refresh: async ({ clientActionId }) => ({ action: await transactions.reconcile(clientActionId), positions: await positions.list(signer.address) }) });
      executor = new ReviewedTransactionExecutor(transactions, checkpoint, executionAdapter);
    }
    const polymarketClient = config.strategy.startsWith("polymarket_")
      ? new PolymarketClient(config.polymarketClobUrl)
      : undefined;
    const roundDecisionStore: RoundDecisionStore = postgresState ?? new FileRoundDecisionStore(bindings.roundStatePath);
    const adapter = createSdkRuntimeAdapter({ client, rpc, priceStore, checkpoint, config, roundDecisionStore, ...(polymarketClient ? { polymarketClient } : {}), ...(signer ? { owner: signer.address } : {}), ...(executor ? { executor } : {}) });
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    process.once("SIGTERM", () => controller.abort());
    const maximumTicks = selectedMaximumTicks();
    try {
      const runtimeLease = postgresState && signer
        ? await requireRuntimeLease(postgresState, {
            cluster: profile === "live" ? "mainnet-beta" : "devnet",
            wallet: signer.address.toString(),
            asset: config.asset,
            expiryFamily: config.expiryFamily,
          }, randomUUID())
        : undefined;
      await runReferenceBot({ config, adapter, once: process.argv.includes("--once"), ...(maximumTicks === undefined ? {} : { maximumTicks }), signal: controller.signal, ...(runtimeLease ? { runtimeLease } : {}) });
    } finally {
      if (postgresState) await postgresState.close();
    }
  } finally { subscription.close(); }
};

try {
  if (process.argv.includes("--fixture-polymarket-bootstrap")) await runPolymarketBootstrapFixtureSmoke();
  else if (process.argv.includes("--fixture-polymarket")) await runPolymarketFixtureSmoke();
  else if (process.argv.includes("--fixture-polymarket-late")) await runPolymarketLateFixtureSmoke();
  else if (process.argv.some((argument) => argument.startsWith("--profile="))) await runSdkBot(selectedProfile());
  else if (process.argv.includes("--live") || process.argv.includes("--live-data")) await runSdkBot(process.argv.includes("--live") ? "live" : "paper");
  else await runFixtureSmoke();
} catch (error) {
  const failure = error instanceof StrykeSdkError ? { code: error.code, message: error.message, retryable: error.retryable } : { code: "configuration", message: error instanceof Error ? error.message : "Reference bot startup failed", retryable: false };
  console.error(JSON.stringify({ event: "reference_bot_error", ...failure }));
  process.exitCode = 1;
}
