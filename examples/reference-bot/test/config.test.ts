import { describe, expect, it, vi } from "vitest";

import { parseReferenceBotConfig, parseReferenceBotEnv, publicConfig, referenceBotDefaults, resolveReferenceBotRuntimeBindings } from "../src/config.js";
import { loadWalletForLiveTrading } from "../src/wallet.js";

describe("reference bot config", () => {
  it("uses_a_conservative_edge_and_bounded_overlapping_positions", () => {
    expect(referenceBotDefaults.estimator).toBe("volatility_adjusted_probability");
    expect(referenceBotDefaults.minimumEntryEdgeBps).toBe(500);
    expect(referenceBotDefaults.maximumOpenPositions).toBe(3);
    expect(referenceBotDefaults.tradeSizeLamports).toBe(10_000n);
    expect(referenceBotDefaults.maximumAggregateExposureLamports).toBe(30_000n);
    expect(parseReferenceBotConfig({ maximumOpenPositions: 2 }).maximumOpenPositions).toBe(2);
  });
  it("validates_volatility_controls_and_preserves_expiry_family_lookbacks", () => {
    const config = parseReferenceBotConfig({
      estimator: "volatility_adjusted_probability",
      historyLookbackSeconds: { one_minute: 60, five_minute: 1_200, fifteen_minute: 900, hourly: 21_600 },
      minimumHistoryCoverageBps: 8_000,
      minimumVolatilityBpsPerSqrtHour: 10,
      maximumVolatilityBpsPerSqrtHour: 1_000,
      maximumModelProbabilityBps: 9_500,
    });
    expect(config.historyLookbackSeconds).toEqual({ one_minute: 60, five_minute: 1_200, fifteen_minute: 900, hourly: 21_600 });
    expect(config).toMatchObject({ estimator: "volatility_adjusted_probability", minimumHistoryCoverageBps: 8_000, minimumVolatilityBpsPerSqrtHour: 10, maximumVolatilityBpsPerSqrtHour: 1_000, maximumModelProbabilityBps: 9_500 });
    expect(() => parseReferenceBotConfig({ historyLookbackSeconds: { one_minute: 59 } as never })).toThrow("historyLookbackSeconds.one_minute");
    expect(() => parseReferenceBotConfig({ minimumVolatilityBpsPerSqrtHour: 100, maximumVolatilityBpsPerSqrtHour: 99 })).toThrow("maximumVolatilityBpsPerSqrtHour");
    expect(() => parseReferenceBotConfig({ maximumModelProbabilityBps: 5_000 })).toThrow("maximumModelProbabilityBps");
  });
  it("defaults_read_only_live_off_and_kill_switch_on", () => {
    expect(referenceBotDefaults).toMatchObject({ readOnlyMode: true, liveTradingEnabled: false, killSwitchEnabled: true });
  });

  it("kill_switch_overrides_live_enablement", async () => {
    const loader = vi.fn();
    await expect(loadWalletForLiveTrading(parseReferenceBotConfig({ readOnlyMode: false, liveTradingEnabled: true, killSwitchEnabled: true }), loader)).resolves.toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it("read_only_mode_never_loads_wallet", async () => {
    const loader = vi.fn();
    await loadWalletForLiveTrading(parseReferenceBotConfig({ liveTradingEnabled: true, killSwitchEnabled: false }), loader);
    expect(loader).not.toHaveBeenCalled();
  });

  it("invalid_units_bounds_or_conflicting_signers_fail_closed", () => {
    for (const invalid of [
      { maximumTradeSizeLamports: 0n },
      { maximumPriceImpactBps: 10_001 },
      { minimumSecondsToExpiry: 1.5 },
      { maximumOpenPositions: 0 },
      { privateKey: "nope", walletAdapterPath: "./wallet.js" },
    ]) expect(() => parseReferenceBotConfig(invalid)).toThrow();
  });

  it("aggregate_exposure_must_cover_per_trade_cap", () => {
    expect(() => parseReferenceBotConfig({ tradeSizeLamports: 1n, maximumTradeSizeLamports: 2n, maximumAggregateExposureLamports: 1n })).toThrow(/maximumAggregateExposureLamports/);
  });

  it("parses_exact_decimal_sol_and_all_runtime_controls", () => {
    const config = parseReferenceBotEnv({
      STRYKE_ASSET: "SOL", STRYKE_EXPIRY_FAMILY: "one_minute",
      STRYKE_ESTIMATOR: "distance_momentum", STRYKE_TRADE_SIZE_SOL: "0.001000001",
      STRYKE_MAXIMUM_TRADE_SIZE_SOL: "0.002", STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL: "0.003",
      STRYKE_MINIMUM_ENTRY_EDGE_BPS: "7", STRYKE_MAXIMUM_PRICE_IMPACT_BPS: "8",
      STRYKE_MINIMUM_SECONDS_TO_EXPIRY: "9", STRYKE_MAXIMUM_OPEN_POSITIONS: "1",
      STRYKE_TICK_INTERVAL_MS: "1000", STRYKE_STOP_LOSS_BPS: "10", STRYKE_TAKE_PROFIT_BPS: "11",
      STRYKE_PRICE_HISTORY_MAX_POINTS: "12", STRYKE_READ_ONLY_MODE: "true",
      STRYKE_LIVE_TRADING_ENABLED: "false", STRYKE_KILL_SWITCH_ENABLED: "true",
      STRYKE_API_BASE_URL: "https://api.example.com", STRYKE_SOLANA_RPC_URL: "https://rpc.example.com",
      STRYKE_PYTH_HERMES_URL: "https://hermes.example.com", STRYKE_CHECKPOINT_PATH: "state/checkpoint.json",
      STRYKE_WALLET_ADAPTER_PATH: "./wallet.mjs",
    });
    expect(config).toEqual(expect.objectContaining({
      asset: "SOL", expiryFamily: "one_minute", estimator: "distance_momentum",
      tradeSizeLamports: 1_000_001n, maximumTradeSizeLamports: 2_000_000n,
      maximumAggregateExposureLamports: 3_000_000n, minimumEntryEdgeBps: 7,
      maximumPriceImpactBps: 8, minimumSecondsToExpiry: 9, maximumOpenPositions: 1,
      tickIntervalMs: 1000, stopLossBps: 10, takeProfitBps: 11, priceHistoryMaxPoints: 12,
      apiBaseUrl: "https://api.example.com", solanaRpcUrl: "https://rpc.example.com",
      pythHermesUrl: "https://hermes.example.com", checkpointPath: "state/checkpoint.json",
      walletAdapterPath: "./wallet.mjs",
    }));
  });

  it("validates_each_documented_numeric_control_at_its_boundaries", () => {
    const bounded = [
      ["minimumEntryEdgeBps", 0, 10_000],
      ["maximumPriceImpactBps", 0, 9_999],
      ["minimumSecondsToExpiry", 0, Number.MAX_SAFE_INTEGER],
      ["maximumOpenPositions", 1, 100],
      ["tickIntervalMs", 1_000, Number.MAX_SAFE_INTEGER],
      ["stopLossBps", 1, 10_000],
      ["takeProfitBps", 1, Number.MAX_SAFE_INTEGER],
      ["priceHistoryMaxPoints", 2, 100_000],
    ] as const;
    for (const [name, minimum, maximum] of bounded) {
      expect(parseReferenceBotConfig({ [name]: minimum })).toHaveProperty(name, minimum);
      expect(parseReferenceBotConfig({ [name]: maximum })).toHaveProperty(name, maximum);
      expect(() => parseReferenceBotConfig({ [name]: minimum - 1 })).toThrow(name);
      expect(() => parseReferenceBotConfig({ [name]: maximum + 1 })).toThrow(name);
      if (minimum !== maximum) expect(() => parseReferenceBotConfig({ [name]: minimum + 0.5 })).toThrow(name);
    }
  });

  it("validates_enum_decimal_connection_and_precedence_controls_independently", () => {
    for (const [name, value] of [
      ["asset", "ETH"], ["expiryFamily", "daily"], ["estimator", "magic"],
      ["apiBaseUrl", ""], ["solanaRpcUrl", ""], ["pythHermesUrl", ""],
      ["checkpointPath", ""], ["walletAdapterPath", ""],
    ] as const) expect(() => parseReferenceBotConfig({ [name]: value })).toThrow(name);

    expect(parseReferenceBotEnv({ STRYKE_TRADE_SIZE_SOL: "0.000000001" }).tradeSizeLamports).toBe(1n);
    for (const value of ["0", "-1", "1.0000000001", "1e-3", " 1"]) {
      expect(() => parseReferenceBotEnv({ STRYKE_TRADE_SIZE_SOL: value })).toThrow("STRYKE_TRADE_SIZE_SOL");
    }
    expect(() => parseReferenceBotEnv({ STRYKE_TRADE_SIZE_SOL: "0.002", STRYKE_MAXIMUM_TRADE_SIZE_SOL: "0.001" })).toThrow("tradeSizeLamports");
    expect(() => parseReferenceBotEnv({ STRYKE_TRADE_SIZE_SOL: "0.001", STRYKE_MAXIMUM_TRADE_SIZE_SOL: "0.002", STRYKE_MAXIMUM_AGGREGATE_EXPOSURE_SOL: "0.001" })).toThrow("maximumAggregateExposureLamports");
  });

  it("projects_connection_and_file_controls_into_the_cli_runtime_consumers", () => {
    const config = parseReferenceBotEnv({
      STRYKE_API_BASE_URL: "https://api.example.com",
      STRYKE_SOLANA_RPC_URL: "https://rpc.example.com",
      STRYKE_PYTH_HERMES_URL: "https://hermes.example.com",
      STRYKE_CHECKPOINT_PATH: "state/checkpoint.json",
      STRYKE_WALLET_ADAPTER_PATH: "wallet/adapter.mjs",
    });
    expect(resolveReferenceBotRuntimeBindings(config, "/tmp/reference-bot")).toEqual({
      apiBaseUrl: "https://api.example.com",
      solanaRpcUrl: "https://rpc.example.com",
      pythHermesUrl: "https://hermes.example.com",
      checkpointPath: "/tmp/reference-bot/state/checkpoint.json",
      roundStatePath: "/tmp/reference-bot/.stryke/reference-bot-rounds.json",
      walletAdapterPath: "/tmp/reference-bot/wallet/adapter.mjs",
    });
  });

  it("wires_postgres_state_controls_and_redacts_the_database_url", () => {
    const config = parseReferenceBotEnv({
      STRYKE_STATE_BACKEND: "postgres",
      STRYKE_DATABASE_URL: "postgres://user:secret@db.example.com/stryke",
      STRYKE_STATE_NAMESPACE: "btc-bootstrap",
      STRYKE_LEASE_TTL_MS: "45000",
    });
    expect(config).toMatchObject({
      stateBackend: "postgres",
      stateDatabaseUrl: "postgres://user:secret@db.example.com/stryke",
      stateNamespace: "btc-bootstrap",
      leaseTtlMs: 45_000,
    });
    expect(publicConfig(config).stateDatabaseUrl).toBe("[configured]");
    expect(() => parseReferenceBotEnv({ STRYKE_STATE_BACKEND: "postgres" })).toThrow("stateDatabaseUrl");
    expect(() => parseReferenceBotEnv({ STRYKE_STATE_BACKEND: "postgres", STRYKE_DATABASE_URL: "postgres://db", STRYKE_LEASE_TTL_MS: "4999" })).toThrow("leaseTtlMs");
  });

  it("active_live_requires_every_explicit_control_before_wallet_or_api_work", () => {
    expect(() => parseReferenceBotEnv({}, "devnet")).toThrow(/STRYKE_ASSET/);
  });

  it("paper_profile_overrides_unsafe_env_and_never_enables_transactions", () => {
    const config = parseReferenceBotEnv({
      STRYKE_READ_ONLY_MODE: "false",
      STRYKE_LIVE_TRADING_ENABLED: "true",
      STRYKE_KILL_SWITCH_ENABLED: "false",
    }, "paper");
    expect(config).toMatchObject({ profile: "paper", readOnlyMode: true, liveTradingEnabled: false, killSwitchEnabled: true });
  });

  it("live_profile_enables_mainnet_execution_and_requires_explicit_controls", () => {
    expect(() => parseReferenceBotEnv({}, "live")).toThrow(/STRYKE_ASSET/);
  });

  it("wires_polymarket_controls_from_env_and_validates_hysteresis", () => {
    expect(parseReferenceBotEnv({
      STRYKE_STRATEGY: "polymarket_early",
      STRYKE_POLY_ENTRY_EDGE_BPS: "501",
      STRYKE_POLY_EXIT_EDGE_BPS: "199",
      STRYKE_POLY_MAX_SPREAD_BPS: "999",
      STRYKE_POLY_MAX_PRICE_AGE_MS: "4999",
      STRYKE_POLY_TIMEOUT_MS: "2999",
      STRYKE_POLYMARKET_CLOB_URL: "https://clob.example",
    })).toMatchObject({
      strategy: "polymarket_early",
      polymarketEntryEdgeBps: 501,
      polymarketExitEdgeBps: 199,
      polymarketMaximumSpreadBps: 999,
      polymarketMaximumPriceAgeMs: 4999,
      polymarketTimeoutMs: 2999,
      polymarketClobUrl: "https://clob.example",
    });
    expect(() => parseReferenceBotConfig({ polymarketEntryEdgeBps: 500, polymarketExitEdgeBps: 500 })).toThrow("polymarketExitEdgeBps");
    expect(() => parseReferenceBotConfig({ polymarketEntryEdgeBps: 500, polymarketExitEdgeBps: 501 })).toThrow("polymarketExitEdgeBps");
    expect(parseReferenceBotConfig({ polymarketEntryEdgeBps: 500, polymarketExitEdgeBps: 499 }))
      .toMatchObject({ polymarketEntryEdgeBps: 500, polymarketExitEdgeBps: 499 });
  });

  it("wires_and_validates_early_and_late_strategy_controls", () => {
    expect(parseReferenceBotEnv({
      STRYKE_STRATEGY: "polymarket_late",
      STRYKE_EXPIRY_FAMILY: "five_minute",
      STRYKE_POLY_EARLY_WINDOW_SECONDS: "45",
      STRYKE_POLY_LATE_WINDOW_SECONDS: "18",
      STRYKE_POLY_SUBMISSION_BUFFER_SECONDS: "4",
      STRYKE_POLY_MIN_HOLD_RETURN_BPS: "250",
      STRYKE_POLY_MIN_WIN_PROFIT_BPS: "300",
      STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET: "false",
      STRYKE_POLY_EXIT_POLICY: "hold_to_expiry",
    })).toMatchObject({
      strategy: "polymarket_late", polymarketEarlyWindowSeconds: 45,
      polymarketLateWindowSeconds: 18, polymarketSubmissionBufferSeconds: 4,
      polymarketMinimumHoldReturnBps: 250, polymarketMinimumWinProfitBps: 300,
      polymarketBootstrapEmptyMarket: false,
      polymarketEarlyExitPolicy: "hold_to_expiry",
    });
    expect(() => parseReferenceBotConfig({ strategy: "polymarket_early", expiryFamily: "one_minute" })).toThrow(/Polymarket strategies/);
    expect(() => parseReferenceBotConfig({ strategy: "polymarket_late", polymarketEarlyExitPolicy: "risk_managed" })).toThrow(/must hold_to_expiry/);
    expect(() => parseReferenceBotConfig({ polymarketLateWindowSeconds: 10, polymarketSubmissionBufferSeconds: 10 })).toThrow(/polymarketSubmissionBufferSeconds/);
    expect(() => parseReferenceBotConfig({ polymarketEarlyExitPolicy: "guess" as never })).toThrow(/polymarketEarlyExitPolicy/);
    expect(() => parseReferenceBotEnv({ STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET: "sometimes" })).toThrow(/STRYKE_POLY_BOOTSTRAP_EMPTY_MARKET/);
  });
});
